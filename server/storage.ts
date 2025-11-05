import { 
  users, players, games, bets, chatMessages, andarBaharMatches,
  coinTossGames, coinTossBets, depositSettings,
  type User, type InsertUser,
  type Player, type InsertPlayer,
  type Game, type InsertGame,
  type Bet, type InsertBet,
  type ChatMessage, type InsertChatMessage,
  type AndarBaharMatch, type InsertAndarBaharMatch,
  type CoinTossGame, type InsertCoinTossGame,
  type CoinTossBet, type InsertCoinTossBet,
  type DepositSettings, type InsertDepositSettings
} from "@shared/schema";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, desc, sql, and } from "drizzle-orm";
import bcrypt from "bcrypt";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});
const db = drizzle(pool);

// modify the interface with any CRUD methods
// you might need

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  createAdminUser(user: InsertUser): Promise<User>;
  updateUserStatus(userId: number, status: string): Promise<User | undefined>;
  updateUserLastLogin(userId: number): Promise<User | undefined>;
  getUsersWithPlayerInfo(): Promise<Array<User & { playerInfo?: Player }>>;
  
  // Players
  getPlayer(id: number): Promise<Player | undefined>;
  getPlayerBySocketId(socketId: string): Promise<Player | undefined>;
  createPlayer(player: InsertPlayer): Promise<Player>;
  updatePlayerChips(playerId: number, chips: number): Promise<Player | undefined>;
  updatePlayerStats(playerId: number, wins: number, losses: number): Promise<Player | undefined>;
  updatePlayerOnlineStatus(userId: number, isOnline: boolean): Promise<Player | undefined>;
  updatePlayerFunds(userId: number, chipsToAdd: number): Promise<Player | undefined>;
  getPlayerStatsByUserId(userId: number): Promise<{
    chips: number;
    totalWins: number;
    totalLosses: number;
    totalBetsAmount: number;
    winRate: number;
  } | null>;
  
  // Games
  createGame(game: InsertGame): Promise<Game>;
  updateGameCard(gameId: number, cardNumber: number, cardColor: string): Promise<Game | undefined>;
  markGameCompleted(gameId: number): Promise<Game | undefined>;
  getGameHistory(limit?: number): Promise<Game[]>;
  getTotalGameCount(): Promise<number>;
  getGamesByRoom(roomId: string, limit?: number): Promise<Game[]>;
  getLastCompletedGameBettingStats(roomId: string): Promise<{ totalBets: number; betsByType: { red: number; black: number; low: number; high: number; lucky7: number } } | null>;
  
  // Bets
  createBet(bet: InsertBet): Promise<Bet>;
  getBetsByGame(gameId: number): Promise<Bet[]>;
  getBetsByPlayer(playerId: number, limit?: number): Promise<(Bet & { gameStatus: string })[]>;
  
  // Chat Messages
  createChatMessage(message: InsertChatMessage): Promise<ChatMessage>;
  getChatHistory(roomId: string, limit?: number): Promise<ChatMessage[]>;
  
  // Andar Bahar Matches
  createAndarBaharMatch(match: Partial<InsertAndarBaharMatch>): Promise<AndarBaharMatch>;
  getAndarBaharMatch(matchId: string): Promise<AndarBaharMatch | undefined>;
  updateAndarBaharMatch(matchId: string, updates: Partial<AndarBaharMatch>): Promise<AndarBaharMatch | undefined>;
  getActiveAndarBaharMatches(): Promise<AndarBaharMatch[]>;
  getPlayerActiveMatch(playerId: number): Promise<AndarBaharMatch | undefined>;
  
  // Coin Toss Games
  createCoinTossGame(game: InsertCoinTossGame): Promise<CoinTossGame>;
  updateCoinTossResult(gameId: number, result: string): Promise<CoinTossGame | undefined>;
  markCoinTossGameCompleted(gameId: number): Promise<CoinTossGame | undefined>;
  getCoinTossGameHistory(limit?: number): Promise<CoinTossGame[]>;
  getTotalCoinTossGameCount(): Promise<number>;
  getLastCompletedCoinTossGameBettingStats(roomId: string): Promise<{ totalBets: number; betsByType: { heads: number; tails: number } } | null>;
  
  // Coin Toss Bets
  createCoinTossBet(bet: InsertCoinTossBet): Promise<CoinTossBet>;
  getCoinTossBetsByGame(gameId: number): Promise<CoinTossBet[]>;
  placeCoinTossBet(playerId: number, betAmount: number, betType: string, gameId: number): Promise<{ bet: CoinTossBet; updatedPlayer: Player }>;
  resolveCoinTossBet(betId: number, won: boolean, winAmount: number): Promise<{ bet: CoinTossBet; updatedPlayer?: Player }>;
  
  // Authentication
  verifyUserPassword(username: string, password: string): Promise<User | null>;
  
  // Advanced betting operations
  placeBet(playerId: number, betAmount: number, betType: string, betValue: string | null, gameId: number): Promise<{ bet: Bet; updatedPlayer: Player }>;
  resolveBet(betId: number, won: boolean, winAmount: number): Promise<{ bet: Bet; updatedPlayer?: Player }>;
  
  // Deposit Settings
  getDepositSettings(): Promise<DepositSettings | undefined>;
  updateDepositSettings(settings: InsertDepositSettings): Promise<DepositSettings>;
  
  // Data Reset
  resetAllGameData(): Promise<void>;
  resetAllUserData(): Promise<void>;
  resetCompleteDatabase(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.id, id));
    return result[0];
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }

  async createUser(user: InsertUser): Promise<User> {
    // Hash password before storing
    const hashedPassword = await bcrypt.hash(user.password, 10);
    const result = await db.insert(users).values({
      ...user,
      password: hashedPassword,
    }).returning();
    return result[0];
  }
  
  async verifyUserPassword(username: string, password: string): Promise<User | null> {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    
    const isValid = await bcrypt.compare(password, user.password);
    return isValid ? user : null;
  }
  
  async getAllUsers(): Promise<User[]> {
    const result = await db.select().from(users);
    return result;
  }

  async createAdminUser(user: InsertUser): Promise<User> {
    // Hash password before storing
    const hashedPassword = await bcrypt.hash(user.password, 10);
    const result = await db.insert(users).values({
      ...user,
      password: hashedPassword,
      role: 'admin'
    }).returning();
    return result[0];
  }

  async updateUserStatus(userId: number, status: string): Promise<User | undefined> {
    const result = await db.update(users)
      .set({ status })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async updateUserLastLogin(userId: number): Promise<User | undefined> {
    const result = await db.update(users)
      .set({ lastLogin: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return result[0];
  }

  async getUsersWithPlayerInfo(): Promise<Array<User & { playerInfo?: Player }>> {
    // Join users with players to get comprehensive user information
    const result = await db
      .select({
        // User fields
        id: users.id,
        username: users.username,
        password: users.password,
        role: users.role,
        status: users.status,
        lastLogin: users.lastLogin,
        createdAt: users.createdAt,
        // Player fields
        playerId: players.id,
        chips: players.chips,
        totalWins: players.totalWins,
        totalLosses: players.totalLosses,
        totalBetsAmount: players.totalBetsAmount,
        isOnline: players.isOnline,
        lastActivity: players.lastActivity,
      })
      .from(users)
      .leftJoin(players, eq(users.id, players.userId));

    // Group the results properly
    const usersWithPlayerInfo = result.map(row => ({
      id: row.id,
      username: row.username,
      password: row.password,
      role: row.role,
      status: row.status,
      lastLogin: row.lastLogin,
      createdAt: row.createdAt,
      playerInfo: row.playerId ? {
        id: row.playerId,
        userId: row.id,
        socketId: '', // This field won't be used in admin view
        name: row.username,
        chips: row.chips || 0,
        totalWins: row.totalWins || 0,
        totalLosses: row.totalLosses || 0,
        totalBetsAmount: row.totalBetsAmount || 0,
        isOnline: row.isOnline || false,
        lastActivity: row.lastActivity || new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      } : undefined
    }));

    return usersWithPlayerInfo;
  }
  
  // Players
  async getPlayer(id: number): Promise<Player | undefined> {
    const result = await db.select().from(players).where(eq(players.id, id));
    return result[0];
  }
  
  async getPlayerBySocketId(socketId: string): Promise<Player | undefined> {
    const result = await db.select().from(players).where(eq(players.socketId, socketId));
    return result[0];
  }
  
  async getPlayerByUserId(userId: number): Promise<Player | undefined> {
    const result = await db.select().from(players).where(eq(players.userId, userId));
    return result[0];
  }
  
  async createPlayer(player: InsertPlayer): Promise<Player> {
    // Check if player already exists with this socketId
    const existing = await this.getPlayerBySocketId(player.socketId);
    if (existing) {
      return existing;
    }
    const result = await db.insert(players).values(player).returning();
    return result[0];
  }
  
  async createOrUpdatePlayerByUserId(userId: number, socketId: string, name: string): Promise<Player> {
    // Check if player already exists for this user
    const existing = await this.getPlayerByUserId(userId);
    if (existing) {
      // Update existing player's socketId (they've reconnected)
      const result = await db.update(players)
        .set({ 
          socketId,
          name, // Update name in case it changed
          updatedAt: new Date() 
        })
        .where(eq(players.userId, userId))
        .returning();
      return result[0];
    } else {
      // Create new player for this user
      const result = await db.insert(players).values({
        userId,
        socketId,
        name,
        chips: 0, // New players start with 0 chips
      }).returning();
      return result[0];
    }
  }
  
  async updatePlayerChips(playerId: number, chips: number): Promise<Player | undefined> {
    if (chips < 0) {
      throw new Error('Chip balance cannot be negative');
    }
    const result = await db.update(players)
      .set({ chips, updatedAt: new Date() })
      .where(eq(players.id, playerId))
      .returning();
    return result[0];
  }
  
  // Atomic betting operation with transaction
  async placeBet(playerId: number, betAmount: number, betType: string, betValue: string | null, gameId: number): Promise<{ bet: Bet; updatedPlayer: Player }> {
    return await db.transaction(async (tx) => {
      // Lock player row and check balance
      const player = await tx.select().from(players)
        .where(eq(players.id, playerId))
        .for('update');
      
      if (!player[0]) {
        throw new Error('Player not found');
      }
      
      if (player[0].chips < betAmount) {
        throw new Error('Insufficient chips');
      }
      
      // Create the bet (outcome will be determined later)
      const bet = await tx.insert(bets).values({
        gameId,
        playerId,
        betAmount,
        betType,
        betValue,
        won: false, // Will be updated when game resolves
        winAmount: 0,
      }).returning();
      
      // Deduct chips from player
      const updatedPlayer = await tx.update(players)
        .set({ 
          chips: player[0].chips - betAmount,
          updatedAt: new Date() 
        })
        .where(eq(players.id, playerId))
        .returning();
      
      return { bet: bet[0], updatedPlayer: updatedPlayer[0] };
    });
  }
  
  // Update bet outcome and award winnings
  async resolveBet(betId: number, won: boolean, winAmount: number): Promise<{ bet: Bet; updatedPlayer?: Player }> {
    return await db.transaction(async (tx) => {
      // Update bet outcome
      const bet = await tx.update(bets)
        .set({ won, winAmount })
        .where(eq(bets.id, betId))
        .returning();
      
      let updatedPlayer;
      if (won && winAmount > 0) {
        // Award winnings to player
        const player = await tx.select().from(players)
          .where(eq(players.id, bet[0].playerId));
        
        if (player[0]) {
          updatedPlayer = await tx.update(players)
            .set({ 
              chips: player[0].chips + winAmount,
              totalWins: player[0].totalWins + 1,
              updatedAt: new Date() 
            })
            .where(eq(players.id, bet[0].playerId))
            .returning();
        }
      } else {
        // Update loss count
        const player = await tx.select().from(players)
          .where(eq(players.id, bet[0].playerId));
        
        if (player[0]) {
          updatedPlayer = await tx.update(players)
            .set({ 
              totalLosses: player[0].totalLosses + 1,
              updatedAt: new Date() 
            })
            .where(eq(players.id, bet[0].playerId))
            .returning();
        }
      }
      
      return { bet: bet[0], updatedPlayer: updatedPlayer?.[0] };
    });
  }
  
  async updatePlayerStats(playerId: number, wins: number, losses: number): Promise<Player | undefined> {
    const result = await db.update(players)
      .set({ totalWins: wins, totalLosses: losses, updatedAt: new Date() })
      .where(eq(players.id, playerId))
      .returning();
    return result[0];
  }

  async updatePlayerOnlineStatus(userId: number, isOnline: boolean): Promise<Player | undefined> {
    const result = await db.update(players)
      .set({ 
        isOnline,
        lastActivity: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(players.userId, userId))
      .returning();
    return result[0];
  }

  async updatePlayerFunds(userId: number, chipsToAdd: number): Promise<Player | undefined> {
    // Get current player data
    const player = await this.getPlayerByUserId(userId);
    if (!player) {
      throw new Error('Player not found');
    }

    const newChips = player.chips + chipsToAdd;
    if (newChips < 0) {
      throw new Error('Cannot reduce chips below zero');
    }

    const result = await db.update(players)
      .set({ 
        chips: newChips,
        updatedAt: new Date() 
      })
      .where(eq(players.userId, userId))
      .returning();
    return result[0];
  }

  async getPlayerStatsByUserId(userId: number): Promise<{
    chips: number;
    totalWins: number;
    totalLosses: number;
    totalBetsAmount: number;
    winRate: number;
  } | null> {
    const player = await this.getPlayerByUserId(userId);
    if (!player) {
      return null;
    }

    const totalGames = player.totalWins + player.totalLosses;
    const winRate = totalGames > 0 ? (player.totalWins / totalGames) * 100 : 0;

    return {
      chips: player.chips,
      totalWins: player.totalWins,
      totalLosses: player.totalLosses,
      totalBetsAmount: player.totalBetsAmount,
      winRate: Math.round(winRate * 100) / 100 // Round to 2 decimal places
    };
  }
  
  // Games
  async createGame(game: InsertGame): Promise<Game> {
    const result = await db.insert(games).values(game).returning();
    return result[0];
  }
  
  async updateGameCard(gameId: number, cardNumber: number, cardColor: string): Promise<Game | undefined> {
    const result = await db.update(games)
      .set({ cardNumber, cardColor })
      .where(eq(games.id, gameId))
      .returning();
    return result[0];
  }

  async markGameCompleted(gameId: number): Promise<Game | undefined> {
    const result = await db.update(games)
      .set({ status: 'completed' })
      .where(eq(games.id, gameId))
      .returning();
    return result[0];
  }

  async getGameHistory(limit: number = 50): Promise<Game[]> {
    return await db.select().from(games)
      .where(eq(games.status, 'completed'))
      .orderBy(desc(games.createdAt))
      .limit(limit);
  }

  async getTotalGameCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(games)
      .where(eq(games.status, 'completed'));
    return result[0]?.count || 0;
  }
  
  async getGamesByRoom(roomId: string, limit: number = 20): Promise<Game[]> {
    return await db.select().from(games)
      .where(eq(games.roomId, roomId))
      .orderBy(desc(games.createdAt))
      .limit(limit);
  }

  async getLastCompletedGameBettingStats(roomId: string): Promise<{ totalBets: number; betsByType: { red: number; black: number; low: number; high: number; lucky7: number } } | null> {
    // Get the most recent completed game
    const latestGame = await db.select().from(games)
      .where(and(eq(games.roomId, roomId), eq(games.status, 'completed')))
      .orderBy(desc(games.createdAt))
      .limit(1);

    if (!latestGame[0]) {
      return null;
    }

    // Get all bets for that game
    const gameBets = await db.select().from(bets)
      .where(eq(bets.gameId, latestGame[0].id));

    // Calculate betting statistics
    const betsByType = {
      red: 0,
      black: 0,
      low: 0,
      high: 0,
      lucky7: 0
    };

    let totalBets = 0;

    gameBets.forEach(bet => {
      totalBets += bet.betAmount;
      if (betsByType.hasOwnProperty(bet.betType)) {
        betsByType[bet.betType as keyof typeof betsByType] += bet.betAmount;
      }
    });

    return { totalBets, betsByType };
  }
  
  // Bets
  async createBet(bet: InsertBet): Promise<Bet> {
    const result = await db.insert(bets).values(bet).returning();
    return result[0];
  }
  
  async getBetsByGame(gameId: number): Promise<Bet[]> {
    return await db.select().from(bets)
      .where(eq(bets.gameId, gameId))
      .orderBy(desc(bets.createdAt));
  }
  
  async getBetsByPlayer(playerId: number, limit: number = 50): Promise<(Bet & { gameStatus: string })[]> {
    return await db.select({
      id: bets.id,
      gameId: bets.gameId,
      playerId: bets.playerId,
      betAmount: bets.betAmount,
      betType: bets.betType,
      betValue: bets.betValue,
      won: bets.won,
      winAmount: bets.winAmount,
      createdAt: bets.createdAt,
      gameStatus: games.status
    }).from(bets)
      .innerJoin(games, eq(bets.gameId, games.id))
      .where(eq(bets.playerId, playerId))
      .orderBy(desc(bets.createdAt))
      .limit(limit);
  }

  async getAllPlayerBetsWithBalance(playerId: number, limit: number = 50): Promise<any[]> {
    // Get player's current chips to calculate historical balances
    const player = await this.getPlayer(playerId);
    if (!player) return [];

    // Fetch Lucky 7 bets
    const lucky7Bets = await db.select({
      id: bets.id,
      betAmount: bets.betAmount,
      betType: bets.betType,
      won: bets.won,
      winAmount: bets.winAmount,
      createdAt: bets.createdAt,
      gameType: sql<string>`'Lucky 7'`,
      gameId: bets.gameId
    }).from(bets)
      .where(eq(bets.playerId, playerId))
      .orderBy(desc(bets.createdAt))
      .limit(limit);

    // Fetch Coin Toss bets
    const coinTossBetsData = await db.select({
      id: coinTossBets.id,
      betAmount: coinTossBets.betAmount,
      betType: coinTossBets.betType,
      won: coinTossBets.won,
      winAmount: coinTossBets.winAmount,
      createdAt: coinTossBets.createdAt,
      gameType: sql<string>`'Coin Toss'`,
      gameId: coinTossBets.gameId
    }).from(coinTossBets)
      .where(eq(coinTossBets.playerId, playerId))
      .orderBy(desc(coinTossBets.createdAt))
      .limit(limit);

    // Fetch Andar Bahar matches
    const andarBaharBetsData = await db.select({
      id: andarBaharMatches.id,
      betAmount: andarBaharMatches.betAmount,
      betType: sql<string>`CASE 
        WHEN ${andarBaharMatches.winnerPlayerId} = ${playerId} THEN 'Winner' 
        ELSE 'Loser' 
      END`,
      won: sql<boolean>`${andarBaharMatches.winnerPlayerId} = ${playerId}`,
      winAmount: sql<number>`CASE 
        WHEN ${andarBaharMatches.winnerPlayerId} = ${playerId} THEN ${andarBaharMatches.betAmount} * 2 
        ELSE 0 
      END`,
      createdAt: andarBaharMatches.completedAt,
      gameType: sql<string>`'Andar Bahar'`,
      gameId: andarBaharMatches.id
    }).from(andarBaharMatches)
      .where(
        and(
          sql`(${andarBaharMatches.dealerPlayerId} = ${playerId} OR ${andarBaharMatches.guesserPlayerId} = ${playerId})`,
          eq(andarBaharMatches.status, 'completed')
        )
      )
      .orderBy(desc(andarBaharMatches.completedAt))
      .limit(limit);

    // Combine all bets and sort by createdAt
    const allBets = [...lucky7Bets, ...coinTossBetsData, ...andarBaharBetsData]
      .filter(bet => bet.createdAt) // Filter out null createdAt
      .sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, limit);

    // Calculate balance progression from newest to oldest
    let currentBalance = player.chips;
    const betsWithBalance = allBets.map(bet => {
      const balanceAfterBet = currentBalance;
      // Move backwards: add back the bet amount and subtract the win amount
      if (bet.won) {
        currentBalance = currentBalance + bet.betAmount - bet.winAmount;
      } else {
        currentBalance = currentBalance + bet.betAmount;
      }
      
      return {
        ...bet,
        balanceAfter: balanceAfterBet,
        profitLoss: bet.won ? bet.winAmount - bet.betAmount : -bet.betAmount
      };
    });

    return betsWithBalance;
  }
  
  // Chat Messages
  async createChatMessage(message: InsertChatMessage): Promise<ChatMessage> {
    const result = await db.insert(chatMessages).values(message).returning();
    return result[0];
  }
  
  async getChatHistory(roomId: string, limit: number = 50): Promise<ChatMessage[]> {
    return await db.select().from(chatMessages)
      .where(eq(chatMessages.roomId, roomId))
      .orderBy(desc(chatMessages.createdAt))
      .limit(limit);
  }

  // Andar Bahar Matches
  async createAndarBaharMatch(match: Partial<InsertAndarBaharMatch>): Promise<AndarBaharMatch> {
    const result = await db.insert(andarBaharMatches).values(match as InsertAndarBaharMatch).returning();
    return result[0];
  }

  async getAndarBaharMatch(matchId: string): Promise<AndarBaharMatch | undefined> {
    const result = await db.select().from(andarBaharMatches)
      .where(eq(andarBaharMatches.matchId, matchId))
      .limit(1);
    return result[0];
  }

  async updateAndarBaharMatch(matchId: string, updates: Partial<AndarBaharMatch>): Promise<AndarBaharMatch | undefined> {
    const result = await db.update(andarBaharMatches)
      .set(updates)
      .where(eq(andarBaharMatches.matchId, matchId))
      .returning();
    return result[0];
  }

  async getActiveAndarBaharMatches(): Promise<AndarBaharMatch[]> {
    return await db.select().from(andarBaharMatches)
      .where(sql`${andarBaharMatches.status} NOT IN ('completed', 'cancelled')`)
      .orderBy(desc(andarBaharMatches.createdAt));
  }

  async getPlayerActiveMatch(playerId: number): Promise<AndarBaharMatch | undefined> {
    const result = await db.select().from(andarBaharMatches)
      .where(
        and(
          sql`(${andarBaharMatches.dealerPlayerId} = ${playerId} OR ${andarBaharMatches.guesserPlayerId} = ${playerId})`,
          sql`${andarBaharMatches.status} NOT IN ('completed', 'cancelled')`
        )
      )
      .limit(1);
    return result[0];
  }

  // Coin Toss Games
  async createCoinTossGame(game: InsertCoinTossGame): Promise<CoinTossGame> {
    const result = await db.insert(coinTossGames).values(game).returning();
    return result[0];
  }

  async updateCoinTossResult(gameId: number, result: string): Promise<CoinTossGame | undefined> {
    const updateResult = await db.update(coinTossGames)
      .set({ result })
      .where(eq(coinTossGames.id, gameId))
      .returning();
    return updateResult[0];
  }

  async markCoinTossGameCompleted(gameId: number): Promise<CoinTossGame | undefined> {
    const result = await db.update(coinTossGames)
      .set({ status: 'completed' })
      .where(eq(coinTossGames.id, gameId))
      .returning();
    return result[0];
  }

  async getCoinTossGameHistory(limit: number = 50): Promise<CoinTossGame[]> {
    return await db.select().from(coinTossGames)
      .where(eq(coinTossGames.status, 'completed'))
      .orderBy(desc(coinTossGames.createdAt))
      .limit(limit);
  }

  async getTotalCoinTossGameCount(): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(coinTossGames)
      .where(eq(coinTossGames.status, 'completed'));
    return result[0]?.count || 0;
  }

  async getLastCompletedCoinTossGameBettingStats(roomId: string): Promise<{ totalBets: number; betsByType: { heads: number; tails: number } } | null> {
    const latestGame = await db.select().from(coinTossGames)
      .where(
        and(
          eq(coinTossGames.roomId, roomId),
          eq(coinTossGames.status, 'completed')
        )
      )
      .orderBy(desc(coinTossGames.createdAt))
      .limit(1);

    if (!latestGame[0]) {
      return null;
    }

    const gameBets = await db.select().from(coinTossBets)
      .where(eq(coinTossBets.gameId, latestGame[0].id));

    const betsByType = {
      heads: 0,
      tails: 0
    };

    let totalBets = 0;

    gameBets.forEach(bet => {
      totalBets += bet.betAmount;
      if (bet.betType === 'heads') {
        betsByType.heads += bet.betAmount;
      } else if (bet.betType === 'tails') {
        betsByType.tails += bet.betAmount;
      }
    });

    return { totalBets, betsByType };
  }

  // Coin Toss Bets
  async createCoinTossBet(bet: InsertCoinTossBet): Promise<CoinTossBet> {
    const result = await db.insert(coinTossBets).values(bet).returning();
    return result[0];
  }

  async getCoinTossBetsByGame(gameId: number): Promise<CoinTossBet[]> {
    return await db.select().from(coinTossBets)
      .where(eq(coinTossBets.gameId, gameId))
      .orderBy(desc(coinTossBets.createdAt));
  }

  async getPlayerBetsByGame(playerId: number, gameId: number): Promise<CoinTossBet[]> {
    return await db.select().from(coinTossBets)
      .where(
        and(
          eq(coinTossBets.playerId, playerId),
          eq(coinTossBets.gameId, gameId)
        )
      )
      .orderBy(desc(coinTossBets.createdAt));
  }

  async placeCoinTossBet(playerId: number, betAmount: number, betType: string, gameId: number): Promise<{ bet: CoinTossBet; updatedPlayer: Player }> {
    return await db.transaction(async (tx) => {
      const player = await tx.select().from(players)
        .where(eq(players.id, playerId))
        .for('update');
      
      if (!player[0]) {
        throw new Error('Player not found');
      }
      
      if (player[0].chips < betAmount) {
        throw new Error('Insufficient chips');
      }
      
      const bet = await tx.insert(coinTossBets).values({
        gameId,
        playerId,
        betAmount,
        betType,
        won: false,
        winAmount: 0,
      }).returning();
      
      const updatedPlayer = await tx.update(players)
        .set({ 
          chips: player[0].chips - betAmount,
          updatedAt: new Date() 
        })
        .where(eq(players.id, playerId))
        .returning();
      
      return { bet: bet[0], updatedPlayer: updatedPlayer[0] };
    });
  }

  async resolveCoinTossBet(betId: number, won: boolean, winAmount: number): Promise<{ bet: CoinTossBet; updatedPlayer?: Player }> {
    return await db.transaction(async (tx) => {
      const bet = await tx.update(coinTossBets)
        .set({ won, winAmount })
        .where(eq(coinTossBets.id, betId))
        .returning();
      
      let updatedPlayer;
      if (won && winAmount > 0) {
        const player = await tx.select().from(players)
          .where(eq(players.id, bet[0].playerId));
        
        if (player[0]) {
          updatedPlayer = await tx.update(players)
            .set({ 
              chips: player[0].chips + winAmount,
              totalWins: player[0].totalWins + 1,
              updatedAt: new Date() 
            })
            .where(eq(players.id, bet[0].playerId))
            .returning();
        }
      } else {
        const player = await tx.select().from(players)
          .where(eq(players.id, bet[0].playerId));
        
        if (player[0]) {
          updatedPlayer = await tx.update(players)
            .set({ 
              totalLosses: player[0].totalLosses + 1,
              updatedAt: new Date() 
            })
            .where(eq(players.id, bet[0].playerId))
            .returning();
        }
      }
      
      return { bet: bet[0], updatedPlayer: updatedPlayer?.[0] };
    });
  }

  async deleteCoinTossBet(betId: number): Promise<void> {
    await db.delete(coinTossBets)
      .where(eq(coinTossBets.id, betId));
  }

  async deleteBet(betId: number): Promise<void> {
    await db.delete(bets)
      .where(eq(bets.id, betId));
  }

  // Deposit Settings
  async getDepositSettings(): Promise<DepositSettings | undefined> {
    const result = await db.select().from(depositSettings)
      .orderBy(desc(depositSettings.updatedAt))
      .limit(1);
    return result[0];
  }

  async updateDepositSettings(settings: InsertDepositSettings): Promise<DepositSettings> {
    // Check if any settings exist
    const existing = await this.getDepositSettings();
    
    if (existing) {
      // Update existing record
      const result = await db.update(depositSettings)
        .set({
          whatsappNumber: settings.whatsappNumber,
          depositMessage: settings.depositMessage,
          updatedAt: new Date()
        })
        .where(eq(depositSettings.id, existing.id))
        .returning();
      return result[0];
    } else {
      // Create new record
      const result = await db.insert(depositSettings)
        .values(settings)
        .returning();
      return result[0];
    }
  }

  // Data Reset Methods
  async resetAllGameData(): Promise<void> {
    // Delete all game-related data but keep users
    await db.delete(bets);
    await db.delete(coinTossBets);
    await db.delete(games);
    await db.delete(coinTossGames);
    await db.delete(chatMessages);
    await db.delete(andarBaharMatches);
  }

  async resetAllUserData(): Promise<void> {
    // Delete all user and player data but keep game history
    await db.delete(players);
    await db.delete(users);
  }

  async resetCompleteDatabase(): Promise<void> {
    // Delete everything in correct order (respecting foreign keys)
    await db.delete(bets);
    await db.delete(coinTossBets);
    await db.delete(chatMessages);
    await db.delete(games);
    await db.delete(coinTossGames);
    await db.delete(andarBaharMatches);
    await db.delete(players);
    await db.delete(users);
    await db.delete(depositSettings);
  }
}

export const storage = new DatabaseStorage();
