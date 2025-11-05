import { useEffect, useState, useRef } from 'react';
import { socket } from '../lib/socket';
import { useGameStore } from '../lib/stores/useGameStore';
import { useAudio } from '../lib/stores/useAudio';
import Card from './Card';
import CardBack from './CardBack';
import BetResultPopup from './BetResultPopup';
import { Button } from './ui/button';
import { LockKeyhole, XCircle, RotateCcw, CheckCircle } from 'lucide-react';
import type { Card as CardType, GameRoom } from '../types/game';

export default function GameRoom() {
  const { currentRoom, setCurrentRoom, setGameState } = useGameStore();
  const [currentCard, setCurrentCard] = useState<CardType | null>(null);
  const [countdownTime, setCountdownTime] = useState<number>(0);
  const [gameStatus, setGameStatus] = useState<string>('waiting');
  const [playerChips, setPlayerChips] = useState<number>(1000);
  const [recentResults, setRecentResults] = useState<any[]>([]);
  const [socketConnected, setSocketConnected] = useState<boolean>(false);
  const [socketId, setSocketId] = useState<string>('');
  const [totalGameCount, setTotalGameCount] = useState<number>(0);
  const [showBetResultPopup, setShowBetResultPopup] = useState<boolean>(false);
  const [storedBets, setStoredBets] = useState<any[]>([]);
  const [betResults, setBetResults] = useState<any[]>([]);
  const [totalWinAmount, setTotalWinAmount] = useState<number>(0);
  const lastValidBetsRef = useRef<any[]>([]);
  const { playSuccess, playHit } = useAudio();
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [bgVersion] = useState<number>(Date.now());
  
  // Inline betting state
  const [selectedBetType, setSelectedBetType] = useState<string>('');
  const [selectedAmount, setSelectedAmount] = useState<number>(10);
  const [currentBets, setCurrentBets] = useState<any[]>([]);
  const [totalBetAmount, setTotalBetAmount] = useState<number>(0);
  const [lockedBets, setLockedBets] = useState<any[]>([]);
  const [unlockedBets, setUnlockedBets] = useState<any[]>([]);
  const [previousRoundBets, setPreviousRoundBets] = useState<any[]>([]);

  // Bet type mappings for display
  const BET_TYPE_LABELS = {
    'red': '🔴 Red',
    'black': '⚫ Black',
    'high': '📈 High (8-13)',
    'low': '📉 Low (1-6)',
    'lucky7': '🍀 Lucky 7 (12x)'
  };

  // Fullscreen functions
  const enterFullscreen = async () => {
    if (containerRef.current && !document.fullscreenElement) {
      try {
        await containerRef.current.requestFullscreen();
        setIsFullscreen(true);
        
        // Lock to landscape orientation
        if (screen.orientation && (screen.orientation as any).lock) {
          try {
            await (screen.orientation as any).lock('landscape');
          } catch (err) {
            console.log('Orientation lock not supported or failed:', err);
          }
        }
      } catch (err) {
        console.error('Error entering fullscreen:', err);
      }
    }
  };

  const exitFullscreen = async () => {
    // Tell server we're leaving (this will auto-cancel any unlocked bets)
    socket.emit('leave-room');
    
    // Exit fullscreen and close the game
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (err) {
        console.error('Error exiting fullscreen:', err);
      }
    }
    
    // Unlock orientation
    if (screen.orientation && (screen.orientation as any).unlock) {
      try {
        (screen.orientation as any).unlock();
      } catch (err) {
        console.log('Orientation unlock not supported or failed:', err);
      }
    }
    
    // Dispatch custom event to notify App.tsx to navigate back to dashboard
    window.dispatchEvent(new CustomEvent('exitLucky7'));
  };

  const handleFullscreenChange = () => {
    const isCurrentlyFullscreen = !!document.fullscreenElement;
    setIsFullscreen(isCurrentlyFullscreen);
    
    // If user exits fullscreen (ESC key or browser UI), close the game
    if (!isCurrentlyFullscreen) {
      exitFullscreen();
    }
  };

  // Function to calculate if a bet won based on the revealed card
  const isBetWinner = (betType: string, card: CardType): boolean => {
    switch (betType) {
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
  };

  // Function to calculate win amount based on bet type and amount
  const calculateWinAmount = (betType: string, betAmount: number): number => {
    const payoutMultipliers: { [key: string]: number } = {
      'red': 2,    // 1:1 odds = 2x total (stake + equal winnings)
      'black': 2,  // 1:1 odds = 2x total (stake + equal winnings)
      'high': 2,   // 1:1 odds = 2x total (stake + equal winnings)
      'low': 2,    // 1:1 odds = 2x total (stake + equal winnings)
      'lucky7': 12 // 11:1 odds = 12x total (stake + 11x winnings)
    };
    return betAmount * (payoutMultipliers[betType] || 0);
  };

  // Calculate total bet amount
  useEffect(() => {
    const total = currentBets.reduce((sum, bet) => sum + bet.amount, 0);
    setTotalBetAmount(total);
    setStoredBets(currentBets);
    if (currentBets.length > 0) {
      lastValidBetsRef.current = [...currentBets];
    }
  }, [currentBets]);

  const canPlaceBet = () => {
    const availableBalance = playerChips - totalBetAmount;
    return gameStatus === 'countdown' && 
           countdownTime > 10 && 
           selectedBetType && 
           selectedAmount > 0 && 
           availableBalance >= selectedAmount;
  };

  const getPlaceBetButtonText = () => {
    if (!selectedBetType) return 'SELECT BET TYPE';
    const availableBalance = playerChips - totalBetAmount;
    if (availableBalance < selectedAmount) {
      return `INSUFFICIENT (${availableBalance} available)`;
    }
    if (gameStatus !== 'countdown' || countdownTime <= 10) return 'BETTING CLOSED';
    return `PLACE BET (${selectedAmount})`;
  };

  const handlePlaceBet = () => {
    if (!canPlaceBet()) return;

    const newBet = {
      type: selectedBetType,
      value: selectedBetType,
      amount: selectedAmount
    };

    setCurrentBets(prev => {
      const updated = [...prev, newBet];
      lastValidBetsRef.current = updated;
      return updated;
    });
    
    setUnlockedBets(prev => [...prev, newBet]);
    playHit();

    socket.emit('place-bet', {
      roomId: currentRoom?.id,
      betType: selectedBetType,
      amount: selectedAmount
    });

    console.log(`Placed bet: ${selectedAmount} on ${selectedBetType}`);
  };

  const handleLockBet = () => {
    if (unlockedBets.length === 0) return;
    if (playerChips === null) return;
    
    socket.emit('lock-bet', { roomId: currentRoom?.id });
    console.log(`Locking ${unlockedBets.length} bet(s)`);
  };

  const handleCancelBet = () => {
    if (unlockedBets.length === 0) return;
    
    socket.emit('cancel-bet', { roomId: currentRoom?.id });
    console.log(`Cancelling ${unlockedBets.length} unlocked bet(s)`);
  };

  const handleCancelLockedBet = () => {
    if (lockedBets.length === 0) return;
    
    socket.emit('cancel-bet', { roomId: currentRoom?.id, cancelLocked: true });
    console.log(`Cancelling ${lockedBets.length} locked bet(s)`);
  };

  const handleRepeatBet = () => {
    if (previousRoundBets.length === 0) return;
    if (lockedBets.length > 0 || unlockedBets.length > 0) return;
    
    const totalPreviousBet = previousRoundBets.reduce((sum, bet) => sum + bet.amount, 0);
    if (playerChips < totalPreviousBet) {
      alert('Insufficient chips to repeat previous bets');
      return;
    }

    // Place all previous bets again
    previousRoundBets.forEach(bet => {
      const newBet = {
        type: bet.type,
        value: bet.value,
        amount: bet.amount
      };

      setCurrentBets(prev => {
        const updated = [...prev, newBet];
        lastValidBetsRef.current = updated;
        return updated;
      });
      
      setUnlockedBets(prev => [...prev, newBet]);

      socket.emit('place-bet', {
        roomId: currentRoom?.id,
        betType: bet.type,
        amount: bet.amount
      });
    });

    playHit();
    console.log('Repeating previous round bets:', previousRoundBets);
  };

  // Function to calculate bet results and show popup
  const showBetResults = (card: CardType) => {
    // Use ref to get the most recent valid bets to prevent race conditions
    const betsToProcess = lastValidBetsRef.current.length > 0 ? lastValidBetsRef.current : storedBets;
    
    console.log(`🎲 showBetResults: Card ${card.number} ${card.color}`);
    console.log(`📊 Bets to process: ${betsToProcess.length}`, betsToProcess);
    console.log(`📋 Current bets state: ${currentBets.length}`, currentBets);
    console.log(`💾 Stored bets: ${storedBets.length}`, storedBets);
    console.log(`🔖 Ref bets: ${lastValidBetsRef.current.length}`, lastValidBetsRef.current);
    
    // Only show popup if user actually placed bets
    if (betsToProcess.length === 0) {
      console.log('❌ No bets to process, skipping popup');
      // Make sure popup is closed if it was somehow open
      setShowBetResultPopup(false);
      setBetResults([]);
      setTotalWinAmount(0);
      return;
    }

    const results = betsToProcess.map(bet => {
      const won = isBetWinner(bet.type, card);
      const winAmount = won ? calculateWinAmount(bet.type, bet.amount) : 0;
      console.log(`Bet ${bet.type} ${bet.amount} chips: ${won ? 'WON' : 'LOST'} (payout: ${winAmount})`);
      return {
        type: bet.type,
        value: bet.value,
        amount: bet.amount,
        won,
        winAmount,
        betTypeLabel: BET_TYPE_LABELS[bet.type as keyof typeof BET_TYPE_LABELS] || bet.type
      };
    });

    const totalWin = results.reduce((sum, result) => sum + result.winAmount, 0);
    const totalBet = results.reduce((sum, result) => sum + result.amount, 0);
    const netWinnings = results.reduce((sum, result) => sum + (result.won ? result.winAmount - result.amount : 0), 0);
    
    console.log(`Results: Total bet: ${totalBet}, Total payout: ${totalWin}, Net winnings: ${netWinnings}`);
    
    // Additional safety check - only show popup if there are actually results to display
    if (results.length > 0 && totalBet > 0) {
      setBetResults(results);
      setTotalWinAmount(totalWin);
      setShowBetResultPopup(true);
      console.log('Showing bet results popup');
      
      // Auto-close popup after 3 seconds
      setTimeout(() => {
        setShowBetResultPopup(false);
        console.log('Auto-closed bet results popup after 3 seconds');
      }, 3000);
    } else {
      console.log('No valid bet results to display, skipping popup');
      setShowBetResultPopup(false);
      setBetResults([]);
      setTotalWinAmount(0);
    }
    
    // Clear the ref after processing to prepare for next round
    lastValidBetsRef.current = [];
  };

  // Fetch recent results only when needed
  const fetchResults = async () => {
    try {
      const response = await fetch('/api/games/recent');
      if (response.ok) {
        const data = await response.json();
        setRecentResults(data.slice(0, 10));
      }
    } catch (error) {
      console.error('Failed to fetch recent results:', error);
    }
  };

  // Fetch total game count (real round number)
  const fetchGameCount = async () => {
    try {
      const response = await fetch('/api/games/count');
      if (response.ok) {
        const data = await response.json();
        setTotalGameCount(data.totalGames);
      }
    } catch (error) {
      console.error('Failed to fetch game count:', error);
    }
  };

  // Monitor socket connection
  useEffect(() => {
    const handleConnect = () => {
      setSocketConnected(true);
      setSocketId(socket.id || '');
    };

    const handleDisconnect = () => {
      setSocketConnected(false);
      setSocketId('');
    };

    // Check initial connection state
    if (socket.connected && socket.id) {
      setSocketConnected(true);
      setSocketId(socket.id);
    }

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchResults();
    fetchGameCount();
  }, []);

  // Auto-enter fullscreen on mount and listen for fullscreen changes
  useEffect(() => {
    // Enter fullscreen when component mounts
    enterFullscreen();
    
    // Listen for fullscreen changes
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Socket listeners for bet management
  useEffect(() => {
    const handleBetPlaced = (data: { bet: any; chips: number }) => {
      setCurrentBets(prev => {
        const updated = [...prev];
        const lastBet = updated[updated.length - 1];
        if (lastBet && !lastBet.betId) {
          lastBet.betId = data.bet.id;
        }
        lastValidBetsRef.current = updated;
        return updated;
      });
      setPlayerChips(data.chips);
    };

    const handleBetsLocked = (data: { bets: any[]; chips: number }) => {
      const locked = data.bets.map(bet => ({
        type: bet.betType,
        value: bet.betType === 'lucky7' ? '7' : bet.betType,
        amount: bet.betAmount,
        betId: bet.betId
      }));
      setLockedBets(locked);
      setUnlockedBets([]);
      
      // Update currentBets to include locked bets (important for restored bets on reconnect)
      setCurrentBets(prev => {
        const existingBetIds = new Set(prev.map(b => b.betId).filter(id => id !== undefined));
        const newBets = locked.filter(bet => !existingBetIds.has(bet.betId));
        const updated = [...prev, ...newBets];
        lastValidBetsRef.current = updated;
        return updated;
      });
      
      // Update player chips (important for reconnect scenario)
      setPlayerChips(data.chips);
      
      console.log(`Locked ${locked.length} bet(s), total current bets now includes locked bets, chips: ${data.chips}`);
    };

    const handleBetsCancelled = (data: { message: string; chips: number }) => {
      setCurrentBets(prev => {
        const updated = prev.filter(bet => 
          !unlockedBets.some(ub => ub.betId === bet.betId)
        );
        lastValidBetsRef.current = updated;
        return updated;
      });
      setUnlockedBets([]);
      setPlayerChips(data.chips);
    };

    const handleLockedBetsCancelled = (data: { message: string; chips: number }) => {
      setCurrentBets(prev => {
        const updated = prev.filter(bet => 
          !lockedBets.some(lb => lb.betId === bet.betId)
        );
        lastValidBetsRef.current = updated;
        return updated;
      });
      setLockedBets([]);
      setPlayerChips(data.chips);
    };

    socket.on('bet-placed', handleBetPlaced);
    socket.on('bets-locked', handleBetsLocked);
    socket.on('bets-cancelled', handleBetsCancelled);
    socket.on('locked-bets-cancelled', handleLockedBetsCancelled);

    return () => {
      socket.off('bet-placed', handleBetPlaced);
      socket.off('bets-locked', handleBetsLocked);
      socket.off('bets-cancelled', handleBetsCancelled);
      socket.off('locked-bets-cancelled', handleLockedBetsCancelled);
    };
  }, [unlockedBets, lockedBets]);

  useEffect(() => {
    function onGameState(data: { status: string; countdownTime: number; currentCard: CardType | null; room: GameRoom }) {
      // Sync initial game state when joining mid-round
      console.log('Received initial game state:', data);
      setCurrentRoom(data.room);
      
      if (data.status === 'countdown') {
        setGameStatus('countdown');
        setGameState('countdown');
        setCountdownTime(data.countdownTime);
        console.log(`Joined during countdown with ${data.countdownTime}s remaining`);
      } else if (data.status === 'playing' && data.currentCard) {
        setGameStatus('revealed');
        setGameState('playing');
        setCurrentCard(data.currentCard);
        console.log('Joined during card reveal');
      } else {
        setGameStatus('waiting');
        setGameState('waiting');
        // Preserve countdown time even in waiting phase
        if (data.countdownTime !== undefined && data.countdownTime > 0) {
          setCountdownTime(data.countdownTime);
          console.log(`Joined during waiting phase with ${data.countdownTime}s remaining`);
        } else {
          console.log('Joined during waiting phase');
        }
      }
    }

    function onRoomUpdated(room: GameRoom) {
      setCurrentRoom(room);
      // Update player chips from room data
      const currentPlayer = room.players.find((p: any) => p.socketId === socket.id);
      if (currentPlayer && currentPlayer.chips !== undefined) {
        setPlayerChips(currentPlayer.chips);
      }
    }
    
    function onGameStarting(data: { room: GameRoom; countdownTime: number }) {
      setCurrentRoom(data.room);
      setCountdownTime(data.countdownTime);
      setGameStatus('countdown');
      setGameState('countdown');
      // Play game start sound
      playSuccess();
    }

    function onCountdownTick(data: { time: number; room: GameRoom }) {
      setCountdownTime(data.time);
      // Don't update room state on every tick to prevent frequent updates
      // Room state will be updated by other events when needed
    }

    function onCardRevealed(data: { card: CardType; room: GameRoom }) {
      setCurrentCard(data.card);
      setCurrentRoom(data.room);
      setGameStatus('revealed');
      setGameState('playing');
      
      // Show bet results popup after 3 seconds to let user see the card first
      setTimeout(() => {
        showBetResults(data.card);
      }, 3000);
    }

    function onRoundEnded(data: { room: GameRoom }) {
      // Save current bets as previous round bets before a new round starts
      if (currentBets.length > 0) {
        setPreviousRoundBets([...currentBets]);
      }
      
      setCurrentRoom(data.room);
      setGameStatus('waiting');
      setGameState('waiting');
      setCurrentCard(null);
      setCountdownTime(0);
      // Play round end sound
      playHit();
      // Update recent results when new round starts (after 3-second delay)
      fetchResults();
      // Update game count to reflect the new round number
      fetchGameCount();
      
      // Clear all bets after a short delay to allow results to be shown
      setTimeout(() => {
        setCurrentBets([]);
        setLockedBets([]);
        setUnlockedBets([]);
        setSelectedBetType('');
      }, 100);
    }

    socket.on('game-state', onGameState);
    socket.on('room-updated', onRoomUpdated);
    socket.on('game-starting', onGameStarting);
    socket.on('countdown-tick', onCountdownTick);
    socket.on('card-revealed', onCardRevealed);
    socket.on('round-ended', onRoundEnded);

    return () => {
      socket.off('game-state', onGameState);
      socket.off('room-updated', onRoomUpdated);
      socket.off('game-starting', onGameStarting);
      socket.off('countdown-tick', onCountdownTick);
      socket.off('card-revealed', onCardRevealed);
      socket.off('round-ended', onRoundEnded);
    };
  }, [setCurrentRoom, setGameState, playSuccess, playHit]);

  const handleLeaveRoom = () => {
    socket.emit('leave-room');
    setCurrentRoom(null);
    setCurrentCard(null);
    setCountdownTime(0);
    setGameStatus('waiting');
  };

  if (!currentRoom) return null;

  const getStatusMessage = () => {
    switch (gameStatus) {
      case 'countdown':
        return 'Get ready! Card revealing in...';
      case 'revealed':
        return 'Card Revealed!';
      case 'waiting':
        // Always show countdown even in waiting status
        if (countdownTime > 0) {
          return `Round in progress: ${countdownTime}s`;
        }
        return 'New round starting...';
      default:
        return 'Welcome to Lucky 7!';
    }
  };

  const BET_TYPES = [
    { id: 'high', label: 'High', icon: '📈', description: '8-13', odds: '1:1', color: 'from-blue-600 to-blue-800' },
    { id: 'low', label: 'Low', icon: '📉', description: '1-6', odds: '1:1', color: 'from-green-600 to-green-800' },
    { id: 'lucky7', label: 'Lucky 7', icon: '🍀', description: 'Number 7', odds: '11:1', color: 'from-yellow-500 to-yellow-700' },
    { id: 'red', label: 'Red', icon: '🔴', description: '7 loses', odds: '1:1', color: 'from-red-600 to-red-800' },
    { id: 'black', label: 'Black', icon: '⚫', description: '7 loses', odds: '1:1', color: 'from-gray-700 to-gray-900' },
  ];

  const QUICK_AMOUNTS = [10, 50, 100, 500, 1000, 5000];

  const getBettingStatus = () => {
    if (gameStatus === 'countdown' && countdownTime > 10) return 'BETTING OPEN';
    if (gameStatus === 'countdown' && countdownTime <= 10) return 'BETTING CLOSED';
    if (gameStatus === 'revealed') return 'CARD REVEALED';
    return 'WAITING';
  };

  // Calculate bet amounts by type
  const getBetAmountByType = (betTypeId: string): number => {
    return currentBets
      .filter(bet => bet.type === betTypeId)
      .reduce((sum, bet) => sum + bet.amount, 0);
  };

  return (
    <div ref={containerRef} className="min-h-screen relative p-2 md:p-4">
      {/* Casino Background with Blur */}
      <div 
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: `url(/casino-bg.jpg?v=${bgVersion})`,
          filter: 'blur(8px)',
          zIndex: 0
        }}
      />
      {/* Dark Overlay for better contrast */}
      <div 
        className="absolute inset-0 bg-black/60"
        style={{ zIndex: 1 }}
      />
      
      <div className="max-w-7xl mx-auto h-screen flex flex-col relative" style={{ zIndex: 2 }}>
        {/* Header - Compact for Landscape */}
        <div className="flex justify-between items-center mb-2">
          {/* Left: Chips */}
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-cyan-400 to-cyan-600 flex items-center justify-center shadow-lg shadow-cyan-500/50">
              <span className="text-xl">🪙</span>
            </div>
            <div className="text-cyan-300 font-bold text-xl">{playerChips}</div>
          </div>

          {/* Center: Title & Round Info */}
          <div className="text-center">
            <h1 className="text-2xl md:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-wider">
              LUCKY 7 ARENA
            </h1>
            <div className="text-cyan-400 text-sm font-semibold">
              ROUND #{currentRoom.currentGameId || totalGameCount + 1}
            </div>
          </div>

          {/* Right: Status & Exit */}
          <div className="flex items-center gap-2">
            <div className={`px-3 py-1 rounded-full text-xs font-semibold border-2 ${
              getBettingStatus() === 'BETTING OPEN' 
                ? 'bg-orange-500/20 border-orange-500 text-orange-400'
                : getBettingStatus() === 'BETTING CLOSED'
                ? 'bg-red-500/20 border-red-500 text-red-400'
                : 'bg-cyan-500/20 border-cyan-500 text-cyan-400'
            }`}>
              {getBettingStatus()}
            </div>
            <Button 
              onClick={exitFullscreen}
              className="w-10 h-10 rounded-full bg-red-600 hover:bg-red-700 shadow-lg flex items-center justify-center"
            >
              ✕
            </Button>
          </div>
        </div>

        {/* Main Content Area - Optimized for Landscape */}
        <div className="flex-1 flex gap-4">
          {/* Left: Timer/Card Display */}
          <div className="flex-1 flex items-center justify-center">
            {gameStatus === 'countdown' && (
              <div className="text-center">
                <div className="relative w-32 h-32 md:w-40 md:h-40">
                  <svg className="transform -rotate-90 w-full h-full">
                    <circle
                      cx="50%"
                      cy="50%"
                      r="45%"
                      stroke="rgba(6, 182, 212, 0.2)"
                      strokeWidth="6"
                      fill="none"
                    />
                    <circle
                      cx="50%"
                      cy="50%"
                      r="45%"
                      stroke="url(#gradient)"
                      strokeWidth="6"
                      fill="none"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 45} ${2 * Math.PI * 45}`}
                      strokeDashoffset={2 * Math.PI * 45 * (1 - countdownTime / 30)}
                      className="transition-all duration-1000"
                    />
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-4xl md:text-5xl font-bold text-cyan-400">{countdownTime}s</div>
                  </div>
                </div>
                <p className="text-cyan-300 text-sm mt-2">BETTING CLOSES IN...</p>
              </div>
            )}

            {currentCard && gameStatus === 'revealed' && (
              <div className="flex justify-center scale-90 md:scale-100">
                <Card 
                  number={currentCard.number}
                  suit={currentCard.suit}
                  color={currentCard.color}
                  revealed={currentCard.revealed}
                  large={true}
                />
              </div>
            )}

            {gameStatus === 'waiting' && (
              <div className="text-center">
                {countdownTime > 0 ? (
                  <>
                    <div className="relative w-32 h-32 md:w-40 md:h-40">
                      <svg className="transform -rotate-90 w-full h-full">
                        <circle
                          cx="50%"
                          cy="50%"
                          r="45%"
                          stroke="rgba(6, 182, 212, 0.2)"
                          strokeWidth="6"
                          fill="none"
                        />
                        <circle
                          cx="50%"
                          cy="50%"
                          r="45%"
                          stroke="url(#gradient)"
                          strokeWidth="6"
                          fill="none"
                          strokeLinecap="round"
                          strokeDasharray={`${2 * Math.PI * 45} ${2 * Math.PI * 45}`}
                          strokeDashoffset={2 * Math.PI * 45 * (1 - countdownTime / 30)}
                          className="transition-all duration-1000"
                        />
                        <defs>
                          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#06b6d4" />
                            <stop offset="100%" stopColor="#3b82f6" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="text-4xl md:text-5xl font-bold text-cyan-400">{countdownTime}s</div>
                      </div>
                    </div>
                    <p className="text-cyan-300 text-sm mt-2">ROUND IN PROGRESS...</p>
                  </>
                ) : (
                  <>
                    <div className="w-32 h-32 md:w-40 md:h-40 rounded-full bg-cyan-500/10 border-4 border-cyan-500/30 flex items-center justify-center">
                      <div className="text-4xl">🃏</div>
                    </div>
                    <p className="text-cyan-300 text-sm mt-2">NEXT ROUND STARTING...</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: Betting Area */}
          <div className="flex-1 flex flex-col justify-center gap-3">
            {/* Betting Options - Compact Grid */}
            <div className="grid grid-cols-5 gap-2">
              {BET_TYPES.map((bet) => {
                const betAmount = getBetAmountByType(bet.id);
                return (
                  <div key={bet.id} className="relative">
                    {/* Bet Amount Badge Above Button */}
                    {betAmount > 0 && (
                      <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-gradient-to-r from-green-500 to-green-600 text-white text-xs font-bold px-2 py-0.5 rounded-full z-10 whitespace-nowrap shadow-lg border border-green-300">
                        {betAmount}
                      </div>
                    )}
                    <button
                      onClick={() => setSelectedBetType(bet.id)}
                      className={`relative p-2 rounded-lg border-2 transition-all w-full ${
                        selectedBetType === bet.id
                          ? 'border-cyan-400 bg-cyan-500/20 scale-105'
                          : 'border-cyan-800/30 bg-gradient-to-br ' + bet.color + ' opacity-80 hover:opacity-100'
                      }`}
                    >
                      <div className="text-2xl mb-1">{bet.icon}</div>
                      <div className="text-white font-bold text-xs">{bet.label}</div>
                      <div className="text-cyan-300 text-[10px]">{bet.description}</div>
                      <div className="text-cyan-400 text-[10px] font-semibold">{bet.odds}</div>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Bet Amount Selection */}
            <div className="flex gap-2 justify-center">
              {QUICK_AMOUNTS.map((amount) => (
                <button
                  key={amount}
                  onClick={() => setSelectedAmount(amount)}
                  className={`px-4 py-1.5 rounded-full text-sm font-bold transition-all ${
                    selectedAmount === amount
                      ? 'bg-gradient-to-r from-orange-500 to-orange-600 text-white border-2 border-orange-400'
                      : 'bg-blue-900/50 text-cyan-300 border-2 border-cyan-800/50 hover:border-cyan-600'
                  }`}
                >
                  {amount}
                </button>
              ))}
            </div>

            {/* Action Buttons - Icon Only */}
            <div className="flex gap-2 justify-center">
              {/* Place Bet Button - Icon Only - Hide when bets are locked */}
              {lockedBets.length === 0 && (
                <Button
                  onClick={handlePlaceBet}
                  disabled={!canPlaceBet()}
                  className="p-3 font-bold bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-cyan-500/50 rounded-full"
                  title={getPlaceBetButtonText()}
                >
                  <CheckCircle className="w-6 h-6" />
                </Button>
              )}

              {/* Lock Button - Icon Only */}
              {unlockedBets.length > 0 && (
                <Button
                  onClick={handleLockBet}
                  disabled={gameStatus !== 'countdown' || countdownTime <= 10}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold p-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg rounded-full"
                  title={`Lock ${unlockedBets.length} bet(s)`}
                >
                  <LockKeyhole className="w-5 h-5" />
                </Button>
              )}

              {/* Cancel Button - Icon Only */}
              {unlockedBets.length > 0 && (
                <Button
                  onClick={handleCancelBet}
                  disabled={gameStatus !== 'countdown' || countdownTime <= 10}
                  className="bg-gray-600 hover:bg-gray-700 text-white font-bold p-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg rounded-full"
                  title={`Cancel ${unlockedBets.length} bet(s)`}
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              )}

              {/* Cancel Locked Bets Button - Icon Only */}
              {lockedBets.length > 0 && (
                <Button
                  onClick={handleCancelLockedBet}
                  disabled={gameStatus !== 'countdown' || countdownTime <= 10}
                  className="bg-red-600 hover:bg-red-700 text-white font-bold p-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg rounded-full"
                  title={`Cancel ${lockedBets.length} locked bet(s)`}
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              )}

              {/* Repeat Button - Icon Only */}
              {previousRoundBets.length > 0 && unlockedBets.length === 0 && lockedBets.length === 0 && (
                <Button
                  onClick={handleRepeatBet}
                  disabled={gameStatus !== 'countdown' || countdownTime <= 10 || playerChips < previousRoundBets.reduce((sum, bet) => sum + bet.amount, 0)}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg rounded-full"
                  title={`Repeat ${previousRoundBets.length} bet(s) - Total: ${previousRoundBets.reduce((sum, bet) => sum + bet.amount, 0)}`}
                >
                  <RotateCcw className="w-5 h-5" />
                </Button>
              )}
            </div>

            {/* Locked Status */}
            {lockedBets.length > 0 && (
              <div className="bg-yellow-600/20 border border-yellow-600 rounded p-2 text-center">
                <span className="text-yellow-400 font-bold text-xs flex items-center justify-center gap-1">
                  <LockKeyhole className="w-3 h-3" />
                  {lockedBets.length} Locked - Can Cancel
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Recent Results - Bottom with Better Visibility */}
        <div className="mt-2 bg-black/30 rounded-lg p-2">
          <div className="text-cyan-300 text-xs mb-2 text-center font-bold">RECENT RESULTS</div>
          <div className="flex justify-center gap-2">
            {recentResults.slice(0, 7).map((result) => {
              const getResultDisplay = (cardNumber: number) => {
                if (cardNumber === 7) return '7';
                if (cardNumber >= 8 && cardNumber <= 13) return 'H';
                return 'L';
              };
              
              const getResultColor = (cardNumber: number) => {
                if (cardNumber === 7) {
                  return 'bg-gradient-to-br from-yellow-400 to-yellow-600 border-yellow-300 text-black shadow-yellow-500/50';
                }
                return result.cardColor === 'red' 
                  ? 'bg-gradient-to-br from-orange-500 to-orange-700 border-orange-300 text-white shadow-orange-500/50' 
                  : 'bg-gradient-to-br from-cyan-400 to-blue-500 border-cyan-300 text-white shadow-cyan-500/50';
              };
              
              return (
                <div 
                  key={result.id}
                  className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold border-3 shadow-lg ${getResultColor(result.cardNumber)}`}
                  title={`Card: ${result.cardNumber} (${result.cardNumber === 7 ? 'Lucky 7' : result.cardNumber >= 8 ? 'High' : 'Low'})`}
                >
                  {getResultDisplay(result.cardNumber)}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bet Result Popup */}
        {currentCard && (
          <BetResultPopup
            isOpen={showBetResultPopup}
            onClose={() => setShowBetResultPopup(false)}
            betResults={betResults}
            totalWinAmount={totalWinAmount}
            revealedCard={{
              number: currentCard.number,
              color: currentCard.color,
              suit: currentCard.suit
            }}
          />
        )}
      </div>
    </div>
  );
}
