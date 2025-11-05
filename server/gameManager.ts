import { Server, Socket } from "socket.io";
import { storage } from "./storage";
import type { Player as DBPlayer } from "@shared/schema";
import crypto from "crypto";

export interface HouseStats {
  totalWagered: number;  // Total amount wagered by all players
  totalPaidOut: number;  // Total amount paid out as winnings
  houseProfitThisRound: number;  // Profit for current round
  houseProfitTotal: number;  // Cumulative house profit
  roundCount: number;  // Number of rounds completed
  houseEdgePercent: number;  // Current house edge percentage
}

export interface Player {
  id: string;
  name: string;
  socketId: string;
  chips?: number;
  dbId?: number; // Reference to database player ID
}

export interface GameRoom {
  id: string;
  players: Player[];
  status: 'waiting' | 'countdown' | 'playing' | 'finished';
  maxPlayers: number;
  currentCard: Card | null;
  countdownTime: number;
  gameStartTime: number | null;
  currentGameId?: number; // Database game ID for bet tracking
  activeBets?: Map<string, any[]>; // socketId -> bets array
  roundNumber?: number; // Current round number
  houseStats?: HouseStats; // House profit tracking
}

export interface Card {
  number: number;
  suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
  color: 'red' | 'black';
  revealed: boolean;
}

export class GameManager {
  private io: Server;
  private globalRoom: GameRoom;
  private playerRooms: Map<string, string>; // socketId -> roomId (kept for compatibility)
  private countdownIntervals: Map<string, NodeJS.Timeout>;
  private adminOverrides: Map<number, string>; // gameId -> override result
  private lockedBets: Map<number, Array<{ betType: string; amount: number; betId: number }>>; // dbId -> locked bets
  private unlockedBets: Map<string, Array<{ betType: string; amount: number; betId: number }>>; // socketId -> unlocked bets

  constructor(io: Server) {
    this.io = io;
    this.playerRooms = new Map();
    this.countdownIntervals = new Map();
    this.adminOverrides = new Map();
    this.lockedBets = new Map();
    this.unlockedBets = new Map();
    
    // Create one global room for everyone
    this.globalRoom = {
      id: 'GLOBAL',
      players: [],
      status: 'waiting',
      maxPlayers: 999999, // No practical limit
      currentCard: null,
      countdownTime: 30,
      gameStartTime: null,
      activeBets: new Map(),
      roundNumber: 1,
      houseStats: {
        totalWagered: 0,
        totalPaidOut: 0,
        houseProfitThisRound: 0,
        houseProfitTotal: 0,
        roundCount: 0,
        houseEdgePercent: 0
      }
    };
    
    // Set up betting event handlers
    this.setupBettingHandlers();
    
    // Auto-start the first game when server starts (after a small delay)
    setTimeout(() => {
      this.startGame(null as any, 'GLOBAL');
    }, 5000); // 5 seconds after server start
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  private generateSmartCard(room: GameRoom): Card {
    /**
     * CRITICAL: This function NEVER selects number 7 automatically.
     * Number 7 can ONLY be chosen when admin_override = true.
     * 
     * Color Rules:
     * - Red: hearts ♥ or diamonds ♦
     * - Black: spades ♠ or clubs ♣
     * 
     * Number Range Rules:
     * - Low: 1-6 (excludes 7)
     * - High: 8-13 (excludes 7)
     * - Lucky 7: number 7 ONLY via admin override
     * 
     * Payout Multipliers:
     * - red/black/low/high: 2x (even money + stake)
     * - lucky7: 12x (11:1 + stake)
     * 
     * Win Conditions:
     * - Red bets: win if color is red AND number ≠ 7
     * - Black bets: win if color is black AND number ≠ 7
     * - Low bets: win if number is 1-6
     * - High bets: win if number is 8-13
     * - Lucky7 bets: win ONLY if number is 7
     */
    
    // Calculate total bets on all bet types
    let lowBetTotal = 0;
    let highBetTotal = 0;
    let lucky7BetTotal = 0;
    let redBetTotal = 0;
    let blackBetTotal = 0;
    
    if (room.activeBets) {
      room.activeBets.forEach((bets) => {
        bets.forEach(bet => {
          if (bet.betType === 'low') {
            lowBetTotal += bet.betAmount;
          } else if (bet.betType === 'high') {
            highBetTotal += bet.betAmount;
          } else if (bet.betType === 'lucky7') {
            lucky7BetTotal += bet.betAmount;
          } else if (bet.betType === 'red') {
            redBetTotal += bet.betAmount;
          } else if (bet.betType === 'black') {
            blackBetTotal += bet.betAmount;
          }
        });
      });
    }
    
    console.log(`Bet Analysis - Low: ${lowBetTotal}, High: ${highBetTotal}, Lucky7: ${lucky7BetTotal}, Red: ${redBetTotal}, Black: ${blackBetTotal}`);
    
    let number: number;
    let outcome: string;
    let color: 'red' | 'black';
    let suit: 'spades' | 'hearts' | 'diamonds' | 'clubs';
    
    // Check if there are any bets at all
    const totalBets = lowBetTotal + highBetTotal + lucky7BetTotal + redBetTotal + blackBetTotal;
    
    if (totalBets === 0) {
      // No bets placed - generate random number from 1-13 EXCLUDING 7
      const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
      suit = suits[crypto.randomInt(0, suits.length)];
      // Generate number from 1-13 excluding 7
      const validNumbers = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13];
      number = validNumbers[crypto.randomInt(0, validNumbers.length)];
      color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
      outcome = 'No bets placed - random result (7 excluded)';
    } else {
      // Calculate total payout for each possible card outcome combination
      // We need to find the combination that results in MINIMUM total payout
      // NUMBER 7 IS EXCLUDED - it can only be chosen via admin override
      // 
      // When 7 is NOT chosen, lucky7 bets always lose (no payout)
      // Other bets win based on their conditions:
      const outcomes = [
        // Red Low (1-6): Red + Low win, Lucky7 loses, Black + High lose
        { type: 'red-low', totalPayout: (redBetTotal * 2) + (lowBetTotal * 2), color: 'red' as const, validNumbers: [1, 2, 3, 4, 5, 6] },
        // Red High (8-13): Red + High win, Lucky7 loses, Black + Low lose
        { type: 'red-high', totalPayout: (redBetTotal * 2) + (highBetTotal * 2), color: 'red' as const, validNumbers: [8, 9, 10, 11, 12, 13] },
        // Black Low (1-6): Black + Low win, Lucky7 loses, Red + High lose
        { type: 'black-low', totalPayout: (blackBetTotal * 2) + (lowBetTotal * 2), color: 'black' as const, validNumbers: [1, 2, 3, 4, 5, 6] },
        // Black High (8-13): Black + High win, Lucky7 loses, Red + Low lose
        { type: 'black-high', totalPayout: (blackBetTotal * 2) + (highBetTotal * 2), color: 'black' as const, validNumbers: [8, 9, 10, 11, 12, 13] }
        // NOTE: Lucky 7 outcome is EXCLUDED - it's only available via admin override
      ];
      
      // Find the minimum payout
      const minPayout = Math.min(...outcomes.map(o => o.totalPayout));
      
      // Get all outcomes that have the minimum payout (for tie-breaking)
      const minPayoutOutcomes = outcomes.filter(o => o.totalPayout === minPayout);
      
      console.log(`Found ${minPayoutOutcomes.length} outcome(s) with minimum payout of ${minPayout}`);
      
      // Deterministic tie-breaker: use game ID + stable game start time as seed
      // This ensures the same outcome is always selected for the same tied scenario
      let selectedOutcome;
      if (minPayoutOutcomes.length === 1) {
        selectedOutcome = minPayoutOutcomes[0];
      } else {
        // Use seeded random selection for deterministic tie-breaking
        // Seed based on current game ID and gameStartTime (stable per round)
        const seed = (room.currentGameId || 0) + (room.gameStartTime || 0);
        const seedBuffer = Buffer.from(seed.toString());
        const hash = crypto.createHash('sha256').update(seedBuffer).digest();
        const randomIndex = hash.readUInt32BE(0) % minPayoutOutcomes.length;
        selectedOutcome = minPayoutOutcomes[randomIndex];
        console.log(`Tie-breaker: selected outcome ${randomIndex} (${selectedOutcome.type}) from ${minPayoutOutcomes.length} tied outcomes using seed ${seed}`);
      }
      
      // Generate number from the valid numbers for this outcome
      number = selectedOutcome.validNumbers[crypto.randomInt(0, selectedOutcome.validNumbers.length)];
      
      // Set color and suit based on outcome
      if (selectedOutcome.color === 'red') {
        const redSuits = ['hearts', 'diamonds'] as const;
        suit = redSuits[crypto.randomInt(0, redSuits.length)];
        color = 'red';
      } else {
        const blackSuits = ['spades', 'clubs'] as const;
        suit = blackSuits[crypto.randomInt(0, blackSuits.length)];
        color = 'black';
      }
      
      outcome = `${selectedOutcome.type} (payout: ${selectedOutcome.totalPayout})`;
    }
    
    console.log(`Smart card generated: ${number} ${color} ${suit} - ${outcome}`);
    
    return {
      number,
      suit,
      color,
      revealed: false
    };
  }

  private generateCardForResult(result: string): Card {
    const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
    const suitIndex = crypto.randomInt(0, suits.length);
    const suit = suits[suitIndex];
    
    let number: number;
    let color: 'red' | 'black';
    
    switch (result) {
      case 'red':
        color = 'red';
        // Avoid 7 to ensure red wins
        const redNumbers = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13];
        number = redNumbers[crypto.randomInt(0, redNumbers.length)];
        break;
      case 'black':
        color = 'black';
        // Avoid 7 to ensure black wins
        const blackNumbers = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13];
        number = blackNumbers[crypto.randomInt(0, blackNumbers.length)];
        break;
      case 'low':
        number = crypto.randomInt(1, 7); // 1-6
        color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
        break;
      case 'high':
        number = crypto.randomInt(8, 14); // 8-13
        color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
        break;
      case 'lucky7':
        number = 7;
        color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
        break;
      default:
        // Fallback to low number
        number = crypto.randomInt(1, 7);
        color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
        break;
    }
    
    return {
      number,
      suit,
      color,
      revealed: false
    };
  }

  async addPlayerToLobby(socket: Socket) {
    // Join the global room directly - player creation handled by API endpoints
    await this.joinRoom(socket, 'GLOBAL');
  }

  async joinRoom(socket: Socket, roomId: string) {
    const room = this.globalRoom; // Always use global room
    if (!room) {
      socket.emit('error', 'Game not available');
      return;
    }

    // No player limit check - everyone can join

    // Remove player from any existing room first
    await this.leaveRoom(socket);

    // Create a basic room player object (database persistence handled by API endpoints)
    const player: Player = {
      id: socket.id,
      name: `Player ${room.players.length + 1}`,
      socketId: socket.id,
      chips: 0, // Default chips - real balance from database via API
      dbId: undefined // Will be set when player authenticates and API creates database record
    };

    room.players.push(player);
    this.playerRooms.set(socket.id, 'GLOBAL');
    socket.join('GLOBAL');

    // Emit updated room state (sanitized to prevent card leaks)
    const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
    this.io.to('GLOBAL').emit('room-updated', sanitizedRoom);
    
    // Send current game state to the newly joined player
    const currentGameState = {
      status: room.status,
      countdownTime: room.countdownTime,
      currentCard: room.status === 'playing' && room.currentCard ? {
        ...room.currentCard,
        revealed: room.currentCard.revealed
      } : null,
      room: sanitizedRoom
    };
    socket.emit('game-state', currentGameState);
    
    // If game is already in countdown, send game-starting event to sync the new player
    if (room.status === 'countdown') {
      socket.emit('game-starting', {
        room: sanitizedRoom,
        countdownTime: room.countdownTime
      });
    }
    
    console.log(`Player ${socket.id} joined Lucky 7 game`);

    // Game runs continuously - no need to start on player join
    // Players join the current round in progress
  }

  async leaveRoom(socket: Socket) {
    const roomId = this.playerRooms.get(socket.id);
    if (!roomId) return;

    // Delete immediately to prevent double execution from race condition
    this.playerRooms.delete(socket.id);

    const room = this.globalRoom;

    // Find player before removing
    const player = room.players.find((p: Player) => p.socketId === socket.id);

    // Auto-cancel and refund unlocked bets when player exits
    if (this.unlockedBets.has(socket.id)) {
      const unlockedBets = this.unlockedBets.get(socket.id)!;
      
      try {
        let totalRefund = 0;
        
        // Delete all unlocked bets from the database
        for (const bet of unlockedBets) {
          await storage.deleteBet(bet.betId);
          totalRefund += bet.amount;
          
          // Remove from active bets
          const playerBets = this.globalRoom.activeBets?.get(socket.id);
          if (playerBets) {
            const betIndex = playerBets.findIndex(b => b.id === bet.betId);
            if (betIndex !== -1) {
              playerBets.splice(betIndex, 1);
            }
          }
        }
        
        // Remove active bets entry if empty
        if (this.globalRoom.activeBets?.get(socket.id)?.length === 0) {
          this.globalRoom.activeBets.delete(socket.id);
        }
        
        if (player?.dbId && totalRefund > 0) {
          const dbPlayer = await storage.getPlayer(player.dbId);
          if (dbPlayer) {
            // Refund the player
            await storage.updatePlayerChips(player.dbId, dbPlayer.chips + totalRefund);
            
            console.log(`${unlockedBets.length} unlocked bet(s) auto-cancelled and refunded for disconnected player ${player?.name || socket.id}, total refund: ${totalRefund}`);
          }
        }
      } catch (error) {
        console.error('Error refunding unlocked bets on disconnect:', error);
      }
      
      this.unlockedBets.delete(socket.id);
    }

    // DO NOT clear locked bets - they persist for player reconnection
    // Keep activeBets entry under original socket ID for settlement
    // Duplicates will be prevented in resolveBets by tracking processed betIds
    if (player && player.dbId && this.lockedBets.has(player.dbId)) {
      console.log(`Preserved ${this.lockedBets.get(player.dbId)!.length} locked bet(s) for player ${player.name} (dbId: ${player.dbId}) - will be settled even if offline`);
    }

    // Remove player from room
    room.players = room.players.filter((p: Player) => p.socketId !== socket.id);
    socket.leave(roomId);

    // Emit updated room state (sanitized to prevent card leaks)
    const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
    this.io.to('GLOBAL').emit('room-updated', sanitizedRoom);
    console.log(`Player ${socket.id} left Lucky 7 game`);
  }

  async startGame(socket: Socket, roomId: string) {
    const room = this.globalRoom;
    if (!room || room.status !== 'waiting') return;

    console.log(`Starting Lucky 7 game for everyone`);
    
    room.status = 'countdown';
    room.countdownTime = 30; // 30 second countdown (20s betting + 10s admin override)
    room.gameStartTime = Date.now();

    // Do NOT generate card yet - it will be generated after betting period ends
    room.currentCard = null;
    
    // Create game record with placeholder values - will be updated when card is generated
    try {
      const gameRecord = await storage.createGame({
        roomId: 'GLOBAL',
        cardNumber: 0, // Placeholder - will be updated at 20s mark
        cardColor: 'red', // Placeholder - will be updated at 20s mark
        totalBets: 0,
        totalPlayers: room.players.length
      });
      room.currentGameId = gameRecord.id;
      console.log(`Created game record ${gameRecord.id} for Lucky 7`);
    } catch (error) {
      console.error('Failed to create game record:', error);
    }

    // Send sanitized room without card details to prevent cheating
    const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
    this.io.to('GLOBAL').emit('game-starting', {
      room: sanitizedRoom,
      countdownTime: room.countdownTime
    });

    // Start countdown
    const interval = setInterval(() => {
      room.countdownTime--;
      
      // Generate card at 10 seconds remaining (after 20s betting period, start of 10s admin override period)
      if (room.countdownTime === 10 && !room.currentCard) {
        room.currentCard = this.generateSmartCard(room);
        console.log(`Card generated at 10s mark (after betting closed): ${room.currentCard.number} ${room.currentCard.color}`);
      }
      
      // Send sanitized room without card details during countdown
      const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
      this.io.to('GLOBAL').emit('countdown-tick', {
        time: room.countdownTime,
        room: sanitizedRoom
      });

      if (room.countdownTime <= 0) {
        clearInterval(interval);
        this.countdownIntervals.delete('GLOBAL');
        this.revealCard('GLOBAL');
      }
    }, 1000);

    this.countdownIntervals.set('GLOBAL', interval);
  }

  private async revealCard(roomId: string) {
    const room = this.globalRoom;
    if (!room || !room.currentCard) return;

    // Check for admin override
    const gameId = room.currentGameId;
    if (gameId && this.adminOverrides.has(gameId)) {
      const overrideResult = this.adminOverrides.get(gameId)!;
      room.currentCard = this.generateCardForResult(overrideResult);
      this.adminOverrides.delete(gameId); // Remove override after use
      console.log(`Admin override applied for game ${gameId}: ${overrideResult}`);
    }

    room.status = 'playing';
    if (room.currentCard) {
      room.currentCard.revealed = true;
    }

    console.log(`Revealing card in Lucky 7:`, room.currentCard);

    // Resolve all bets for this game
    await this.resolveBets(room);

    // Update game record with actual revealed card (in case of admin override) and mark as completed
    if (room.currentGameId && room.currentCard) {
      try {
        await storage.updateGameCard(room.currentGameId, room.currentCard.number, room.currentCard.color);
        await storage.markGameCompleted(room.currentGameId);
        console.log(`Game ${room.currentGameId} updated with final card and marked as completed`);
      } catch (error) {
        console.error('Failed to update game card or mark as completed:', error);
      }
    }

    // Now that card is revealed, send full room
    this.io.to('GLOBAL').emit('card-revealed', {
      card: room.currentCard,
      room
    });

    // Wait 6 seconds to show results and popup, then start next round
    setTimeout(() => {
      this.startNextRound('GLOBAL');
    }, 6000);
  }

  private startNextRound(roomId: string) {
    const room = this.globalRoom;
    if (!room) return;

    room.status = 'waiting';
    room.currentCard = null;
    room.countdownTime = 30;
    room.currentGameId = undefined; // Reset game ID for next round
    room.activeBets?.clear(); // Ensure bets are cleared
    room.roundNumber = (room.roundNumber || 1) + 1; // Increment round number
    
    // Clear locked and unlocked bets for new round
    this.lockedBets.clear();
    this.unlockedBets.clear();

    // Send sanitized room (card should be null at this point)
    const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
    this.io.to('GLOBAL').emit('round-ended', { room: sanitizedRoom });

    // Auto-start next round immediately - game runs continuously like a real casino
    // Players can join anytime and bet on the current round
    this.startGame(null as any, 'GLOBAL');
  }

  handleDisconnect(socket: Socket) {
    this.leaveRoom(socket);
  }

  // Betting functionality
  private setupBettingHandlers() {
    this.io.on('connection', (socket) => {
      socket.on('place-bet', async (data: { roomId: string; betType: string; betValue: string; amount: number }) => {
        await this.handlePlaceBet(socket, data);
      });
      
      socket.on('lock-bet', async (data: { roomId: string }) => {
        await this.handleLockBet(socket, data);
      });
      
      socket.on('cancel-bet', async (data: { roomId: string }) => {
        await this.handleCancelBet(socket, data);
      });
      
      // Handle authentication updates
      socket.on('update-player-auth', async (data: { userId: number; username: string }) => {
        await this.handlePlayerAuth(socket, data);
      });
    });
  }

  private async handlePlayerAuth(socket: Socket, data: { userId: number; username: string }) {
    try {
      const room = this.globalRoom;
      if (!room) return;

      // Find the room player for this socket
      const roomPlayer = room.players.find((p: Player) => p.socketId === socket.id);
      if (!roomPlayer) return;

      // Get or create the database player record for this user
      const dbPlayer = await storage.createOrUpdatePlayerByUserId(data.userId, socket.id, data.username);
      
      // Update the room player with database information
      roomPlayer.name = dbPlayer.name;
      roomPlayer.chips = dbPlayer.chips;
      roomPlayer.dbId = dbPlayer.id;

      // Restore locked bets if player has any (from previous session/disconnect)
      let restoredLockedBets: Array<{ betType: string; betAmount: number; betId: number }> = [];
      if (this.lockedBets.has(dbPlayer.id)) {
        const lockedBets = this.lockedBets.get(dbPlayer.id)!;
        restoredLockedBets = lockedBets.map(bet => ({
          betType: bet.betType,
          betAmount: bet.amount,
          betId: bet.betId
        }));
        console.log(`Restored ${restoredLockedBets.length} locked bet(s) for ${roomPlayer.name} (dbId: ${dbPlayer.id})`);
        
        // Remove any stale activeBets entries for this player's bets (prevents duplicate counting)
        if (room.activeBets) {
          const betIdsToRestore = new Set(lockedBets.map(b => b.betId));
          for (const [oldSocketId, bets] of Array.from(room.activeBets.entries())) {
            // Remove bets that match our locked bet IDs from other socket entries
            const filteredBets = bets.filter(bet => !betIdsToRestore.has(bet.id));
            if (filteredBets.length === 0) {
              room.activeBets.delete(oldSocketId);
              console.log(`Removed stale activeBets entry for socket ${oldSocketId}`);
            } else if (filteredBets.length !== bets.length) {
              room.activeBets.set(oldSocketId, filteredBets);
              console.log(`Removed ${bets.length - filteredBets.length} duplicate bet(s) from socket ${oldSocketId}`);
            }
          }
        } else {
          room.activeBets = new Map();
        }
        
        // Now add fresh activeBets mapping with new socket id for settlement
        room.activeBets.set(socket.id, lockedBets.map(bet => ({
          id: bet.betId,
          betType: bet.betType,
          betAmount: bet.amount
        })));
        
        // Send locked bets to the client
        socket.emit('bets-locked', {
          bets: restoredLockedBets.map(bet => ({ betType: bet.betType, betAmount: bet.betAmount, betId: bet.betId, locked: true })),
          chips: dbPlayer.chips
        });
      }

      // Broadcast updated room state
      const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
      this.io.to('GLOBAL').emit('room-updated', sanitizedRoom);
      
      console.log(`Player ${socket.id} authenticated as user ${data.userId} (${data.username}) with ${dbPlayer.chips} chips`);
    } catch (error) {
      console.error('Error handling player authentication:', error);
    }
  }

  private async handlePlaceBet(socket: Socket, data: { roomId: string; betType: string; betValue: string; amount: number }) {
    try {
      const room = this.globalRoom;
      if (!room || room.status !== 'countdown' || room.countdownTime <= 10) {
        socket.emit('bet-error', 'Cannot place bet at this time');
        return;
      }

      // Verify player is in the game and authenticated
      const playerInRoom = room.players.find((p: Player) => p.socketId === socket.id);
      if (!playerInRoom) {
        socket.emit('bet-error', 'You must be in the game to place bets');
        return;
      }

      // Check if player is authenticated (has dbId from authentication)
      if (!playerInRoom.dbId) {
        socket.emit('bet-error', 'Authentication required to place bets');
        return;
      }

      // Get current database player state
      const dbPlayer = await storage.getPlayer(playerInRoom.dbId);
      if (!dbPlayer) {
        socket.emit('bet-error', 'Player record not found');
        return;
      }

      // Validate bet type
      const validBetTypes = ['red', 'black', 'high', 'low', 'lucky7'];
      if (!validBetTypes.includes(data.betType)) {
        socket.emit('bet-error', 'Invalid bet type');
        return;
      }

      // Validate bet amount
      if (data.amount <= 0 || data.amount > dbPlayer.chips) {
        socket.emit('bet-error', 'Invalid bet amount');
        return;
      }

      // Ensure game record exists (should be created in startGame)
      if (!room.currentGameId) {
        socket.emit('bet-error', 'Game not ready for betting');
        return;
      }

      // Place bet in database
      const betResult = await storage.placeBet(
        dbPlayer.id,
        data.amount,
        data.betType,
        data.betValue,
        room.currentGameId
      );

      // Update room player chips
      const roomPlayer = room.players.find((p: Player) => p.socketId === socket.id);
      if (roomPlayer) {
        roomPlayer.chips = betResult.updatedPlayer.chips;
      }

      // Store bet in room for quick access
      if (!room.activeBets) {
        room.activeBets = new Map();
      }
      const playerBets = room.activeBets.get(socket.id) || [];
      playerBets.push(betResult.bet);
      room.activeBets.set(socket.id, playerBets);

      // Track unlocked bet for lock/cancel functionality
      const unlockedBetsList = this.unlockedBets.get(socket.id) || [];
      unlockedBetsList.push({
        betType: data.betType,
        amount: data.amount,
        betId: betResult.bet.id
      });
      this.unlockedBets.set(socket.id, unlockedBetsList);

      // Notify room of updated player chips (sanitized to prevent card leaks)
      const sanitizedRoom = this.sanitizeRoomForBroadcast(room);
      this.io.to('GLOBAL').emit('room-updated', sanitizedRoom);
      socket.emit('bet-placed', { bet: betResult.bet, chips: betResult.updatedPlayer.chips, locked: false });
      
      console.log(`Bet placed: ${data.amount} chips on ${data.betType} by ${socket.id}`);
      
    } catch (error) {
      console.error('Error placing bet:', error);
      socket.emit('bet-error', 'Failed to place bet');
    }
  }

  private async handleLockBet(socket: Socket, data: { roomId: string }) {
    const player = this.globalRoom.players.find(p => p.socketId === socket.id);
    if (!player || !player.dbId) {
      socket.emit('bet-error', { message: 'Player not found' });
      return;
    }

    if (this.globalRoom.status !== 'countdown' || this.globalRoom.countdownTime <= 10) {
      socket.emit('bet-error', { message: 'Betting window closed' });
      return;
    }

    if (this.lockedBets.has(player.dbId)) {
      socket.emit('bet-error', { message: 'You already have locked bets. Locked bets cannot be changed.' });
      return;
    }

    try {
      const betsToLock = this.unlockedBets.get(socket.id);
      
      if (!betsToLock || betsToLock.length === 0) {
        socket.emit('bet-error', { message: 'No bets to lock. Please place a bet first.' });
        return;
      }

      // Mark all bets as locked for persistence (bets are already placed in DB)
      this.lockedBets.set(player.dbId, betsToLock.map(bet => ({
        betType: bet.betType,
        amount: bet.amount,
        betId: bet.betId
      })));

      // Remove from unlocked bets
      this.unlockedBets.delete(socket.id);

      socket.emit('bets-locked', {
        bets: betsToLock.map(bet => ({ betType: bet.betType, betAmount: bet.amount, betId: bet.betId, locked: true })),
        chips: player.chips || 0
      });

      console.log(`Bets locked for persistence: ${player.name} locked ${betsToLock.length} bet(s)`);
    } catch (error: any) {
      console.error('Error locking bets:', error);
      socket.emit('bet-error', { message: error.message });
    }
  }

  private async handleCancelBet(socket: Socket, data: { roomId: string; cancelLocked?: boolean }) {
    const player = this.globalRoom.players.find(p => p.socketId === socket.id);
    if (!player || !player.dbId) {
      socket.emit('bet-error', { message: 'Player not found' });
      return;
    }

    // Check if we should cancel locked bets
    if (data.cancelLocked) {
      return this.handleCancelLockedBets(socket, data);
    }

    // Original logic for canceling unlocked bets
    if (this.lockedBets.has(player.dbId)) {
      socket.emit('bet-error', { message: 'Cannot cancel unlocked bets when you have locked bets. Cancel locked bets first.' });
      return;
    }

    const unlockedBets = this.unlockedBets.get(socket.id);
    if (!unlockedBets || unlockedBets.length === 0) {
      socket.emit('bet-error', { message: 'No unlocked bets to cancel' });
      return;
    }

    try {
      let totalRefund = 0;

      // Delete all unlocked bets from the database and calculate total refund
      for (const bet of unlockedBets) {
        await storage.deleteBet(bet.betId);
        totalRefund += bet.amount;
        
        // Remove from active bets
        const playerBets = this.globalRoom.activeBets?.get(socket.id);
        if (playerBets) {
          const betIndex = playerBets.findIndex(b => b.id === bet.betId);
          if (betIndex !== -1) {
            playerBets.splice(betIndex, 1);
          }
        }
      }

      // Remove active bets entry if empty
      if (this.globalRoom.activeBets?.get(socket.id)?.length === 0) {
        this.globalRoom.activeBets.delete(socket.id);
      }

      // Refund the player
      const dbPlayer = await storage.getPlayer(player.dbId);
      if (dbPlayer) {
        await storage.updatePlayerChips(player.dbId, dbPlayer.chips + totalRefund);
        player.chips = dbPlayer.chips + totalRefund;
      }

      this.unlockedBets.delete(socket.id);

      socket.emit('bets-cancelled', {
        message: `${unlockedBets.length} unlocked bet(s) cancelled and refunded successfully`,
        chips: player.chips
      });

      console.log(`Unlocked bets cancelled and refunded: ${player.name} cancelled ${unlockedBets.length} bet(s), total refund: ${totalRefund}`);
    } catch (error: any) {
      console.error('Error cancelling unlocked bets:', error);
      socket.emit('bet-error', { message: error.message });
    }
  }

  private async handleCancelLockedBets(socket: Socket, data: { roomId: string }) {
    const player = this.globalRoom.players.find(p => p.socketId === socket.id);
    if (!player || !player.dbId) {
      socket.emit('bet-error', { message: 'Player not found' });
      return;
    }

    const lockedBets = this.lockedBets.get(player.dbId);
    if (!lockedBets || lockedBets.length === 0) {
      socket.emit('bet-error', { message: 'No locked bets to cancel' });
      return;
    }

    try {
      let totalRefund = 0;

      // Delete all locked bets from the database and calculate total refund
      for (const bet of lockedBets) {
        await storage.deleteBet(bet.betId);
        totalRefund += bet.amount;
        
        // Remove from active bets
        const playerBets = this.globalRoom.activeBets?.get(socket.id);
        if (playerBets) {
          const betIndex = playerBets.findIndex(b => b.id === bet.betId);
          if (betIndex !== -1) {
            playerBets.splice(betIndex, 1);
          }
        }
      }

      // Remove active bets entry if empty
      if (this.globalRoom.activeBets?.get(socket.id)?.length === 0) {
        this.globalRoom.activeBets.delete(socket.id);
      }

      // Refund the player
      const dbPlayer = await storage.getPlayer(player.dbId);
      if (dbPlayer) {
        await storage.updatePlayerChips(player.dbId, dbPlayer.chips + totalRefund);
        player.chips = dbPlayer.chips + totalRefund;
      }

      this.lockedBets.delete(player.dbId);

      socket.emit('locked-bets-cancelled', {
        message: `${lockedBets.length} locked bet(s) cancelled and refunded successfully`,
        chips: player.chips
      });

      console.log(`Locked bets cancelled and refunded: ${player.name} cancelled ${lockedBets.length} bet(s), total refund: ${totalRefund}`);
    } catch (error: any) {
      console.error('Error cancelling locked bets:', error);
      socket.emit('bet-error', { message: error.message });
    }
  }

  private async resolveBets(room: GameRoom) {
    if (!room.activeBets || !room.currentCard || !room.currentGameId || !room.houseStats) return;

    console.log(`Resolving bets for room ${room.id} - Card: ${room.currentCard.number} ${room.currentCard.color}`);

    let roundWagered = 0;
    let roundPaidOut = 0;
    const processedBetIds = new Set<number>(); // Track processed bets to prevent duplicates

    for (const [socketId, bets] of Array.from(room.activeBets.entries())) {
      for (const bet of bets) {
        // Skip if this bet was already processed (prevents duplicate settlement on reconnect)
        if (processedBetIds.has(bet.id)) {
          console.log(`Skipping duplicate bet ${bet.id} from socket ${socketId} (already processed)`);
          continue;
        }
        
        processedBetIds.add(bet.id);
        
        const won = this.isBetWinner(bet, room.currentCard);
        const winAmount = won ? this.calculateWinAmount(bet) : 0;
        
        // Track house statistics
        roundWagered += bet.betAmount;
        roundPaidOut += winAmount;

        try {
          // Update bet outcome in database
          const result = await storage.resolveBet(bet.id, won, winAmount);
          
          // Update room player chips (try to find by socketId first)
          let roomPlayer = room.players.find((p: Player) => p.socketId === socketId);
          
          // If player not found by socketId (they disconnected), try to find by dbId
          if (!roomPlayer && result?.updatedPlayer) {
            roomPlayer = room.players.find((p: Player) => p.dbId === result.updatedPlayer?.id);
          }
          
          // Update chips in memory if player is still connected
          if (roomPlayer && result?.updatedPlayer) {
            roomPlayer.chips = result.updatedPlayer.chips;
            console.log(`Bet ${bet.id}: ${won ? 'WON' : 'LOST'} - Wager: ${bet.betAmount}, Payout: ${winAmount} (Player: ${roomPlayer.name})`);
          } else {
            // Player disconnected but bet still settled in database
            console.log(`Bet ${bet.id}: ${won ? 'WON' : 'LOST'} - Wager: ${bet.betAmount}, Payout: ${winAmount} (Player disconnected, settled in database)`);
          }
        } catch (error) {
          console.error('Error resolving bet:', error);
        }
      }
    }

    // Update house statistics
    this.updateHouseStats(room, roundWagered, roundPaidOut);

    // Clear active bets
    room.activeBets.clear();
    
    // Clear locked bets map now that round is over
    this.lockedBets.clear();
    console.log('Cleared all locked bets after round settlement');
  }

  private isBetWinner(bet: any, card: Card): boolean {
    switch (bet.betType) {
      case 'red':
        // Red loses on 7 (house number)
        return card.color === 'red' && card.number !== 7;
      case 'black':
        // Black loses on 7 (house number)
        return card.color === 'black' && card.number !== 7;
      case 'high':
        return card.number >= 8;
      case 'low':
        // Low is now 1-6 (7 is excluded as house number)
        return card.number >= 1 && card.number <= 6;
      case 'lucky7':
        return card.number === 7;
      default:
        return false;
    }
  }

  // Sanitize room object to prevent card information leaks during countdown
  private sanitizeRoomForBroadcast(room: GameRoom): GameRoom {
    return {
      ...room,
      // Hide card details during countdown phase
      currentCard: room.status === 'playing' && room.currentCard?.revealed 
        ? room.currentCard 
        : null,
      // Remove internal betting data
      activeBets: undefined
      // Keep currentGameId so clients can display the actual round number
    };
  }

  private calculateWinAmount(bet: any): number {
    // Return total payout (stake + winnings) since resolveBet adds winAmount directly
    // Player already had stake deducted in placeBet, so winAmount should include stake return
    const payoutMultipliers: { [key: string]: number } = {
      'red': 2,    // 1:1 odds = 2x total (stake + equal winnings)
      'black': 2,  // 1:1 odds = 2x total (stake + equal winnings)
      'high': 2,   // 1:1 odds = 2x total (stake + equal winnings)
      'low': 2,    // 1:1 odds = 2x total (stake + equal winnings)
      'lucky7': 12 // 11:1 odds = 12x total (stake + 11x winnings)
    };
    
    const rawAmount = bet.betAmount * (payoutMultipliers[bet.betType] || 0);
    // Round to nearest cent using banker's rounding (round half to even)
    return this.roundToCents(rawAmount);
  }

  private roundToCents(amount: number): number {
    // Standard rounding to nearest cent for financial calculations
    const cents = Math.round(amount * 100);
    return cents / 100;
  }

  private updateHouseStats(room: GameRoom, roundWagered: number, roundPaidOut: number) {
    if (!room.houseStats) return;
    
    const houseProfitThisRound = roundWagered - roundPaidOut;
    
    // Update cumulative statistics
    room.houseStats.totalWagered += roundWagered;
    room.houseStats.totalPaidOut += roundPaidOut;
    room.houseStats.houseProfitThisRound = houseProfitThisRound;
    room.houseStats.houseProfitTotal += houseProfitThisRound;
    room.houseStats.roundCount += 1;
    
    // Calculate current house edge percentage
    if (room.houseStats.totalWagered > 0) {
      room.houseStats.houseEdgePercent = (room.houseStats.houseProfitTotal / room.houseStats.totalWagered) * 100;
    }
    
    console.log(`=== HOUSE STATS ROUND ${room.houseStats.roundCount} ===`);
    console.log(`Round Wagered: $${roundWagered.toFixed(2)}`);
    console.log(`Round Paid Out: $${roundPaidOut.toFixed(2)}`);
    console.log(`House Profit This Round: $${houseProfitThisRound.toFixed(2)}`);
    console.log(`Total Wagered: $${room.houseStats.totalWagered.toFixed(2)}`);
    console.log(`Total Paid Out: $${room.houseStats.totalPaidOut.toFixed(2)}`);
    console.log(`House Profit Total: $${room.houseStats.houseProfitTotal.toFixed(2)}`);
    console.log(`House Edge: ${room.houseStats.houseEdgePercent.toFixed(2)}%`);
    console.log(`==========================================`);
  }

  // Public method to get house statistics for API access
  getHouseStats() {
    return this.globalRoom?.houseStats || null;
  }

  // Get current round data for admin control
  async getCurrentRoundData() {
    const room = this.globalRoom;
    if (!room || !room.currentGameId) {
      return null;
    }

    // Calculate betting totals by type
    const betsByType = {
      red: 0,
      black: 0,
      low: 0,
      high: 0,
      lucky7: 0
    };

    let totalBets = 0;
    let dataSource = 'current'; // Track if we're showing current or last round data

    // Sum up all bets in the current round
    room.activeBets?.forEach((bets, socketId) => {
      bets.forEach(bet => {
        totalBets += bet.betAmount;
        if (betsByType.hasOwnProperty(bet.betType)) {
          betsByType[bet.betType as keyof typeof betsByType] += bet.betAmount;
        }
      });
    });

    // Only show last round data when current round has finished
    // During waiting/countdown/playing phases, always show current data (even if 0)
    if (totalBets === 0 && room.status === 'finished') {
      try {
        const lastRoundStats = await storage.getLastCompletedGameBettingStats(room.id);
        if (lastRoundStats) {
          totalBets = lastRoundStats.totalBets;
          Object.assign(betsByType, lastRoundStats.betsByType);
          dataSource = 'last';
        }
      } catch (error) {
        console.error('Failed to get last round betting stats:', error);
      }
    }

    // Include current card information for admin (only when card is generated)
    let currentCard = null;
    if (room.currentCard && (room.status === 'countdown' || room.status === 'playing')) {
      currentCard = {
        number: room.currentCard.number,
        suit: room.currentCard.suit,
        color: room.currentCard.color,
        revealed: room.currentCard.revealed
      };
    }

    return {
      gameId: room.currentGameId,
      totalBets: totalBets,
      betsByType: betsByType,
      status: room.status,
      timeRemaining: room.status === 'countdown' ? room.countdownTime : undefined,
      dataSource: dataSource, // Include this for debugging/transparency
      currentCard: currentCard // Include current card info for admin
    };
  }

  // Set admin override for a specific game
  setAdminOverride(gameId: number, overrideResult: string): boolean {
    const room = this.globalRoom;
    
    // Only allow overrides during countdown phase
    if (!room || room.status !== 'countdown' || room.currentGameId !== gameId) {
      return false;
    }

    // Validate override result
    const validResults = ['red', 'black', 'low', 'high', 'lucky7'];
    if (!validResults.includes(overrideResult)) {
      return false;
    }

    this.adminOverrides.set(gameId, overrideResult);
    console.log(`Admin override set for game ${gameId}: ${overrideResult}`);
    return true;
  }
}
