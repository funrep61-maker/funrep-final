import type { Express } from "express";
import { storage } from "./storage";
import { insertUserSchema } from "../shared/schema";
import { requireAuth, requireAdmin, optionalAuth, type AuthRequest } from "./middleware/auth";
import multer from "multer";
import path from "path";
import fs from "fs";
// Session types are defined globally in server/types/session.d.ts

// Configure multer for background image uploads
// Store in persistent uploads directory (works in both dev and production)
const backgroundStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Use a temporary filename - we'll rename it after we know the gameType
    const timestamp = Date.now();
    cb(null, `temp-bg-${timestamp}.jpg`);
  }
});

const uploadBackground = multer({
  storage: backgroundStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

export async function registerRoutes(app: Express): Promise<void> {
  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Development endpoint to create users with specific roles
  app.post("/api/dev/create-user", async (req, res) => {
    try {
      const { username, password, role } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Create user with specified role
      let user;
      if (role === 'admin') {
        user = await storage.createAdminUser({ username, password });
      } else {
        user = await storage.createUser({ username, password });
      }

      res.status(201).json({
        id: user.id,
        username: user.username,
        role: user.role,
        message: "User created successfully"
      });
    } catch (error) {
      console.error('Dev create user error:', error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // Get active rooms
  app.get("/api/rooms", (req, res) => {
    // This will be populated by the game manager
    res.json({ rooms: [] });
  });

  // Get recent game results
  app.get("/api/games/recent", async (req, res) => {
    try {
      const games = await storage.getGameHistory(10);
      res.json(games);
    } catch (error) {
      console.error('Error fetching recent games:', error);
      res.status(500).json({ message: "Failed to fetch recent games" });
    }
  });

  // Get total game count (round number)
  app.get("/api/games/count", async (req, res) => {
    try {
      const count = await storage.getTotalGameCount();
      res.json({ totalGames: count });
    } catch (error) {
      console.error('Error fetching game count:', error);
      res.status(500).json({ message: "Failed to fetch game count" });
    }
  });

  // Get player information (chips, stats)
  app.get("/api/player/me", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(404).json({ message: "Player not found" });
      }

      // Get socketId from header for current connection
      const socketId = req.headers['socket-id'] as string;
      if (!socketId) {
        return res.status(400).json({ message: "Socket ID required" });
      }

      // Create or update player record for this user
      const player = await storage.createOrUpdatePlayerByUserId(
        req.user.id,
        socketId,
        req.user.username
      );

      res.json({
        id: player.id,
        name: player.name,
        chips: player.chips,
        totalWins: player.totalWins,
        totalLosses: player.totalLosses
      });
    } catch (error) {
      console.error('Error fetching player data:', error);
      res.status(500).json({ message: "Failed to fetch player data" });
    }
  });

  // Get player bet history
  app.get("/api/player/bets", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Find the player record for this user
      const player = await storage.getPlayerByUserId(req.user.id);
      if (!player) {
        // User doesn't have a player record yet, return empty bets
        return res.json([]);
      }

      const limit = parseInt(req.query.limit as string) || 20;
      const bets = await storage.getBetsByPlayer(player.id, limit);
      res.json(bets);
    } catch (error) {
      console.error('Error fetching bet history:', error);
      res.status(500).json({ message: "Failed to fetch bet history" });
    }
  });

  // Get comprehensive betting history with balance tracking
  app.get("/api/player/betting-history", optionalAuth, async (req: AuthRequest, res) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({ message: "Authentication required" });
      }

      // Find the player record for this user
      const player = await storage.getPlayerByUserId(req.user.id);
      if (!player) {
        // User doesn't have a player record yet, return empty bets
        return res.json([]);
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const betsWithBalance = await storage.getAllPlayerBetsWithBalance(player.id, limit);
      res.json(betsWithBalance);
    } catch (error) {
      console.error('Error fetching comprehensive bet history:', error);
      res.status(500).json({ message: "Failed to fetch bet history" });
    }
  });

  // Authentication routes
  app.post("/api/auth/register", async (req, res) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);
      
      // Check if username already exists
      const existingUser = await storage.getUserByUsername(validatedData.username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Create user
      const user = await storage.createUser(validatedData);
      
      // Store user in session (without password hash)
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt
      };
      
      // Return user without password
      res.status(201).json({
        id: user.id,
        username: user.username,
        role: user.role
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(400).json({ message: "Invalid registration data" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Verify user credentials
      const user = await storage.verifyUserPassword(username, password);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Check user status - deny login for blocked/suspended users
      if (user.status !== 'active') {
        return res.status(403).json({ 
          message: `Account is ${user.status}. Please contact support.` 
        });
      }

      // Update last login time
      await storage.updateUserLastLogin(user.id);

      // Create or update player record and set online status
      await storage.createOrUpdatePlayerByUserId(user.id, 'web-session', user.username);
      await storage.updatePlayerOnlineStatus(user.id, true);

      // Store user in session (without password hash)
      req.session.user = {
        id: user.id,
        username: user.username,
        role: user.role,
        createdAt: user.createdAt
      };

      // Return user without password
      res.json({
        id: user.id,
        username: user.username,
        role: user.role
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ message: "Login failed" });
    }
  });

  app.post("/api/auth/logout", async (req: AuthRequest, res) => {
    try {
      // Set user offline before destroying session
      if (req.session.user) {
        await storage.updatePlayerOnlineStatus(req.session.user.id, false);
      }
      
      // Destroy server session
      req.session.destroy((err) => {
        if (err) {
          console.error('Session destroy error:', err);
          return res.status(500).json({ message: "Logout failed" });
        }
        res.json({ success: true });
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({ message: "Logout failed" });
    }
  });

  // User stats routes - requires authentication
  app.get("/api/users/:userId/stats", requireAuth, async (req: AuthRequest, res) => {
    try {
      const userId = parseInt(req.params.userId);
      if (isNaN(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Users can only access their own stats (unless admin)
      if (req.user!.id !== userId && req.user!.role !== 'admin') {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get user statistics
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // For now, return basic stats
      // This could be expanded to include game history, win/loss ratio, etc.
      res.json({
        username: user.username,
        gamesPlayed: 0, // Placeholder
        totalWins: 0,   // Placeholder
        totalLosses: 0, // Placeholder
      });
    } catch (error) {
      console.error('Stats error:', error);
      res.status(500).json({ message: "Failed to retrieve user stats" });
    }
  });

  // Admin routes - requires admin role
  app.get("/api/admin/users", requireAdmin, async (req: AuthRequest, res) => {
    try {
      // Use enhanced function to get users with player info
      const users = await storage.getUsersWithPlayerInfo();
      
      // Return comprehensive user data without passwords
      const safeUsers = users.map(user => ({
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        // Player information if available
        chips: user.playerInfo?.chips || 0,
        totalWins: user.playerInfo?.totalWins || 0,
        totalLosses: user.playerInfo?.totalLosses || 0,
        totalBetsAmount: user.playerInfo?.totalBetsAmount || 0,
        isOnline: user.playerInfo?.isOnline || false,
        lastActivity: user.playerInfo?.lastActivity,
        winRate: user.playerInfo ? 
          (user.playerInfo.totalWins + user.playerInfo.totalLosses > 0 ? 
            Math.round((user.playerInfo.totalWins / (user.playerInfo.totalWins + user.playerInfo.totalLosses)) * 10000) / 100 : 0) : 0
      }));

      res.json(safeUsers);
    } catch (error) {
      console.error('Admin users error:', error);
      res.status(500).json({ message: "Failed to retrieve users" });
    }
  });

  // Special route to create first admin user (protected by setup token)
  app.post("/api/admin/create-first-admin", async (req, res) => {
    try {
      // Require setup token for security
      const setupToken = req.headers['x-setup-token'] || req.body.setupToken;
      const requiredToken = process.env.ADMIN_SETUP_TOKEN;
      
      if (!requiredToken) {
        return res.status(503).json({ message: "Admin setup not configured" });
      }
      
      if (!setupToken || setupToken !== requiredToken) {
        return res.status(401).json({ message: "Invalid setup token" });
      }

      // Check if any admin users already exist
      const users = await storage.getAllUsers();
      const hasAdmin = users.some(user => user.role === 'admin');
      
      if (hasAdmin) {
        return res.status(400).json({ message: "Admin user already exists" });
      }

      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Create admin user
      const adminUser = await storage.createAdminUser({ username, password });
      
      // Store admin in session (without password hash) and update last login
      await storage.updateUserLastLogin(adminUser.id);
      req.session.user = {
        id: adminUser.id,
        username: adminUser.username,
        role: adminUser.role,
        createdAt: adminUser.createdAt
      };

      res.status(201).json({
        id: adminUser.id,
        username: adminUser.username,
        role: adminUser.role
      });
    } catch (error) {
      console.error('Create admin error:', error);
      res.status(500).json({ message: "Failed to create admin user" });
    }
  });

  // House statistics endpoint for admin monitoring
  app.get("/api/admin/house-stats", requireAdmin, async (req: AuthRequest, res) => {
    try {
      // Admin authentication required
      
      // Get house stats from game manager if available
      const gameManager = (app as any).gameManager;
      
      if (gameManager && gameManager.getHouseStats) {
        const stats = gameManager.getHouseStats();
        if (stats) {
          res.json(stats);
        } else {
          res.json({ 
            message: "House statistics initialized but no data yet",
            houseStats: {
              totalWagered: 0,
              totalPaidOut: 0,
              houseProfitThisRound: 0,
              houseProfitTotal: 0,
              roundCount: 0,
              houseEdgePercent: 0
            }
          });
        }
      } else {
        res.json({ message: "House statistics not available" });
      }
    } catch (error) {
      console.error('Error fetching house statistics:', error);
      res.status(500).json({ message: "Failed to fetch house statistics" });
    }
  });

  // Get current round betting statistics for admin control
  app.get("/api/admin/current-round", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const gameManager = (app as any).gameManager;
      
      if (!gameManager) {
        return res.status(500).json({ message: "Game manager not available" });
      }

      const currentRoundData = await gameManager.getCurrentRoundData();
      
      if (!currentRoundData) {
        return res.json({ message: "No active round found" });
      }

      res.json(currentRoundData);
    } catch (error) {
      console.error('Error fetching current round data:', error);
      res.status(500).json({ message: "Failed to fetch current round data" });
    }
  });

  // Admin override result endpoint
  app.post("/api/admin/override-result", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { gameId, overrideResult } = req.body;
      
      if (!gameId || !overrideResult) {
        return res.status(400).json({ message: "Game ID and override result are required" });
      }

      const validResults = ['red', 'black', 'low', 'high', 'lucky7'];
      if (!validResults.includes(overrideResult)) {
        return res.status(400).json({ message: "Invalid override result" });
      }

      const gameManager = (app as any).gameManager;
      
      if (!gameManager) {
        return res.status(500).json({ message: "Game manager not available" });
      }

      const success = gameManager.setAdminOverride(gameId, overrideResult);
      
      if (success) {
        console.log(`Admin ${req.user!.username} overrode result for game ${gameId} to: ${overrideResult}`);
        res.json({ 
          message: "Result override set successfully",
          gameId: gameId,
          overrideResult: overrideResult
        });
      } else {
        res.status(400).json({ message: "Failed to set override - game may not be in countdown phase" });
      }
    } catch (error) {
      console.error('Error setting admin override:', error);
      res.status(500).json({ message: "Failed to set admin override" });
    }
  });

  // User management endpoints
  // Block/Unblock user
  app.post("/api/admin/users/:userId/status", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { status } = req.body;

      if (!userId || !status) {
        return res.status(400).json({ message: "User ID and status are required" });
      }

      const validStatuses = ['active', 'blocked', 'suspended'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid status. Must be: active, blocked, or suspended" });
      }

      const updatedUser = await storage.updateUserStatus(userId, status);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      console.log(`Admin ${req.user!.username} changed user ${updatedUser.username} status to: ${status}`);
      res.json({ 
        message: `User status updated to ${status}`,
        user: {
          id: updatedUser.id,
          username: updatedUser.username,
          status: updatedUser.status
        }
      });
    } catch (error) {
      console.error('Error updating user status:', error);
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Add/Remove funds
  app.post("/api/admin/users/:userId/funds", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { amount, reason } = req.body;

      if (!userId || amount === undefined) {
        return res.status(400).json({ message: "User ID and amount are required" });
      }

      if (typeof amount !== 'number') {
        return res.status(400).json({ message: "Amount must be a number" });
      }

      const updatedPlayer = await storage.updatePlayerFunds(userId, amount);
      
      if (!updatedPlayer) {
        return res.status(404).json({ message: "Player not found for this user" });
      }

      const action = amount > 0 ? 'added' : 'removed';
      console.log(`Admin ${req.user!.username} ${action} ${Math.abs(amount)} chips ${amount > 0 ? 'to' : 'from'} user ${updatedPlayer.name}. Reason: ${reason || 'No reason provided'}`);
      
      res.json({ 
        message: `Successfully ${action} ${Math.abs(amount)} chips`,
        player: {
          id: updatedPlayer.id,
          name: updatedPlayer.name,
          chips: updatedPlayer.chips,
          changeAmount: amount
        }
      });
    } catch (error) {
      console.error('Error updating user funds:', error);
      const errorMessage = error instanceof Error ? error.message : "Failed to update user funds";
      res.status(500).json({ message: errorMessage });
    }
  });

  // Change user password
  app.post("/api/admin/users/:userId/password", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const userId = parseInt(req.params.userId);
      const { password } = req.body;

      if (!userId || isNaN(userId)) {
        return res.status(400).json({ message: "Valid User ID is required" });
      }

      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters long" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const updatedUser = await storage.updateUserPassword(userId, password);
      
      if (!updatedUser) {
        return res.status(500).json({ message: "Failed to update password" });
      }

      console.log(`Admin ${req.user!.username} changed password for user ${updatedUser.username}`);
      res.json({ 
        message: "Password changed successfully",
        user: {
          id: updatedUser.id,
          username: updatedUser.username
        }
      });
    } catch (error) {
      console.error('Error changing password:', error);
      res.status(500).json({ message: "Failed to change password" });
    }
  });

  // Get detailed user stats  
  app.get("/api/admin/users/:userId/stats", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const userId = parseInt(req.params.userId);

      if (!userId || isNaN(userId)) {
        return res.status(400).json({ message: "Valid User ID is required" });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      const playerStats = await storage.getPlayerStatsByUserId(userId);
      
      res.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          status: user.status,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt
        },
        stats: playerStats || {
          chips: 0,
          totalWins: 0,
          totalLosses: 0,
          totalBetsAmount: 0,
          winRate: 0
        }
      });
    } catch (error) {
      console.error('Error fetching user stats:', error);
      res.status(500).json({ message: "Failed to fetch user stats" });
    }
  });

  // Coin Toss API Routes
  app.get("/api/coin-toss/games/recent", async (req, res) => {
    try {
      const games = await storage.getCoinTossGameHistory(10);
      res.json(games);
    } catch (error) {
      console.error('Error fetching recent coin toss games:', error);
      res.status(500).json({ message: "Failed to fetch recent coin toss games" });
    }
  });

  app.get("/api/coin-toss/games/count", async (req, res) => {
    try {
      const count = await storage.getTotalCoinTossGameCount();
      res.json({ totalGames: count });
    } catch (error) {
      console.error('Error fetching coin toss game count:', error);
      res.status(500).json({ message: "Failed to fetch coin toss game count" });
    }
  });

  app.get("/api/admin/coin-toss/house-stats", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const coinTossManager = (app as any).coinTossManager;
      
      if (!coinTossManager) {
        return res.status(500).json({ message: "Coin toss manager not available" });
      }

      const houseStats = coinTossManager.getHouseStats();
      
      if (houseStats) {
        res.json({
          stats: {
            totalWagered: houseStats.totalWagered,
            totalPaidOut: houseStats.totalPaidOut,
            houseProfitThisRound: houseStats.houseProfitThisRound,
            houseProfitTotal: houseStats.houseProfitTotal,
            roundCount: houseStats.roundCount,
            houseEdgePercent: houseStats.houseEdgePercent
          }
        });
      } else {
        res.json({ message: "Coin toss house statistics not available" });
      }
    } catch (error) {
      console.error('Error fetching coin toss house statistics:', error);
      res.status(500).json({ message: "Failed to fetch coin toss house statistics" });
    }
  });

  app.get("/api/admin/coin-toss/current-round", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const coinTossManager = (app as any).coinTossManager;
      
      if (!coinTossManager) {
        return res.status(500).json({ message: "Coin toss manager not available" });
      }

      const currentRoundData = coinTossManager.getCurrentRoundData();
      
      if (!currentRoundData) {
        return res.json({ message: "No active coin toss round found" });
      }

      res.json(currentRoundData);
    } catch (error) {
      console.error('Error fetching current coin toss round data:', error);
      res.status(500).json({ message: "Failed to fetch current coin toss round data" });
    }
  });

  app.post("/api/admin/coin-toss/override-result", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { gameId, overrideResult } = req.body;
      
      if (!gameId || !overrideResult) {
        return res.status(400).json({ message: "Game ID and override result are required" });
      }

      const validResults = ['heads', 'tails'];
      if (!validResults.includes(overrideResult)) {
        return res.status(400).json({ message: "Invalid override result. Must be 'heads' or 'tails'" });
      }

      const coinTossManager = (app as any).coinTossManager;
      
      if (!coinTossManager) {
        return res.status(500).json({ message: "Coin toss manager not available" });
      }

      const success = coinTossManager.setAdminOverride(gameId, overrideResult);
      
      if (success) {
        console.log(`Admin ${req.user!.username} overrode coin toss result for game ${gameId} to: ${overrideResult}`);
        res.json({ 
          message: "Coin toss result override set successfully",
          gameId: gameId,
          overrideResult: overrideResult
        });
      } else {
        res.status(400).json({ message: "Failed to set override - game may not be in countdown phase" });
      }
    } catch (error) {
      console.error('Error setting coin toss admin override:', error);
      res.status(500).json({ message: "Failed to set coin toss admin override" });
    }
  });

  // Game background upload endpoint
  app.post("/api/admin/game-background", requireAdmin, uploadBackground.single('background'), async (req: AuthRequest, res) => {
    try {
      const { gameType } = req.body;
      
      if (!gameType || !['lucky7', 'cointoss'].includes(gameType)) {
        return res.status(400).json({ message: "Invalid game type. Must be 'lucky7' or 'cointoss'" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      // Determine the correct filename based on gameType
      const targetFilename = gameType === 'lucky7' ? 'casino-bg.jpg' : 'cointoss-bg.jpg';
      
      // Get paths
      const uploadDir = path.join(process.cwd(), 'client', 'public');
      const tempPath = req.file.path;
      const targetPath = path.join(uploadDir, targetFilename);
      
      // Rename the temporary file to the correct target filename
      fs.renameSync(tempPath, targetPath);
      
      console.log(`Admin ${req.user!.username} uploaded new background for ${gameType}: ${targetFilename}`);
      
      res.json({ 
        message: "Background image uploaded successfully",
        gameType: gameType,
        filename: targetFilename,
        path: `/${targetFilename}`
      });
    } catch (error) {
      console.error('Error uploading background image:', error);
      
      // Clean up temp file if it exists
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error('Error removing temp file:', unlinkError);
        }
      }
      
      res.status(500).json({ message: "Failed to upload background image" });
    }
  });

  // Get deposit settings (public - for users)
  app.get("/api/deposit-settings", async (req, res) => {
    try {
      const settings = await storage.getDepositSettings();
      res.json(settings || { whatsappNumber: '', depositMessage: '' });
    } catch (error) {
      console.error('Error fetching deposit settings:', error);
      res.status(500).json({ message: "Failed to fetch deposit settings" });
    }
  });

  // Get deposit settings (admin)
  app.get("/api/admin/deposit-settings", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const settings = await storage.getDepositSettings();
      res.json(settings || { whatsappNumber: '', depositMessage: '' });
    } catch (error) {
      console.error('Error fetching deposit settings:', error);
      res.status(500).json({ message: "Failed to fetch deposit settings" });
    }
  });

  // Update deposit settings (admin only)
  app.post("/api/admin/deposit-settings", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { whatsappNumber, depositMessage } = req.body;
      
      if (!whatsappNumber || !depositMessage) {
        return res.status(400).json({ message: "WhatsApp number and message are required" });
      }

      const settings = await storage.updateDepositSettings({ whatsappNumber, depositMessage });
      
      console.log(`Admin ${req.user!.username} updated deposit settings`);
      
      res.json({ 
        message: "Deposit settings updated successfully",
        settings
      });
    } catch (error) {
      console.error('Error updating deposit settings:', error);
      res.status(500).json({ message: "Failed to update deposit settings" });
    }
  });

  // Data Reset endpoint (admin only)
  app.post("/api/admin/reset-data", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { resetType } = req.body;
      
      if (!resetType) {
        return res.status(400).json({ message: "Reset type is required" });
      }

      const validResetTypes = ['all_game_data', 'all_user_data', 'complete_reset'];
      if (!validResetTypes.includes(resetType)) {
        return res.status(400).json({ message: "Invalid reset type" });
      }

      console.log(`Admin ${req.user!.username} initiated ${resetType} reset`);

      switch (resetType) {
        case 'all_game_data':
          await storage.resetAllGameData();
          console.log('All game data has been reset');
          res.json({ message: "All game data has been successfully reset" });
          break;
        
        case 'all_user_data':
          await storage.resetAllUserData();
          console.log('All user data has been reset');
          res.json({ message: "All user data has been successfully reset" });
          break;
        
        case 'complete_reset':
          await storage.resetCompleteDatabase();
          console.log('Complete database has been reset');
          res.json({ message: "Complete database has been successfully reset" });
          break;
      }
    } catch (error) {
      console.error('Error resetting data:', error);
      res.status(500).json({ message: "Failed to reset data" });
    }
  });

  // Analytics endpoints
  app.get("/api/admin/analytics/overview", requireAdmin, async (req: AuthRequest, res) => {
    try {
      // Get all users and games
      const users = await storage.getUsersWithPlayerInfo();
      const totalGames = await storage.getTotalGameCount();
      const coinTossGames = await storage.getTotalCoinTossGameCount();
      
      // Calculate total revenue and statistics
      const gameManager = (app as any).gameManager;
      const coinTossManager = (app as any).coinTossManager;
      
      let houseStats = { totalWagered: 0, totalPaidOut: 0, houseProfitTotal: 0, houseEdgePercent: 0 };
      let coinTossStats = { totalWagered: 0, totalPaidOut: 0, houseProfitTotal: 0 };
      
      if (gameManager && gameManager.getHouseStats) {
        const stats = gameManager.getHouseStats();
        if (stats) houseStats = stats;
      }
      
      if (coinTossManager && coinTossManager.getHouseStats) {
        const stats = coinTossManager.getHouseStats();
        if (stats) coinTossStats = stats;
      }

      const totalRevenue = houseStats.houseProfitTotal + coinTossStats.houseProfitTotal;
      const totalWagered = houseStats.totalWagered + coinTossStats.totalWagered;
      const totalPaidOut = houseStats.totalPaidOut + coinTossStats.totalPaidOut;
      const overallHouseEdge = totalWagered > 0 ? ((totalRevenue / totalWagered) * 100) : 0;

      // Active players (online now)
      const activePlayers = users.filter(u => u.playerInfo?.isOnline).length;
      
      res.json({
        totalRevenue,
        totalWagered,
        totalPaidOut,
        houseEdge: overallHouseEdge,
        totalPlayers: users.length,
        activePlayers,
        totalGames: totalGames + coinTossGames,
        lucky7Games: totalGames,
        coinTossGames,
      });
    } catch (error) {
      console.error('Error fetching analytics overview:', error);
      res.status(500).json({ message: "Failed to fetch analytics overview" });
    }
  });

  app.get("/api/admin/analytics/game-performance", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const lucky7Games = await storage.getGameHistory(100);
      const coinTossGames = await storage.getCoinTossGameHistory(100);
      
      // Calculate average bets per game
      const lucky7AvgBets = lucky7Games.length > 0 
        ? lucky7Games.reduce((sum, g) => sum + g.totalBets, 0) / lucky7Games.length 
        : 0;
      
      const coinTossAvgBets = coinTossGames.length > 0
        ? coinTossGames.reduce((sum, g) => sum + g.totalBets, 0) / coinTossGames.length
        : 0;

      res.json({
        lucky7: {
          totalGames: lucky7Games.length,
          averageBetAmount: Math.round(lucky7AvgBets),
          popularColors: {
            red: lucky7Games.filter(g => g.cardColor === 'red').length,
            black: lucky7Games.filter(g => g.cardColor === 'black').length,
          }
        },
        coinToss: {
          totalGames: coinTossGames.length,
          averageBetAmount: Math.round(coinTossAvgBets),
          results: {
            heads: coinTossGames.filter(g => g.result === 'heads').length,
            tails: coinTossGames.filter(g => g.result === 'tails').length,
          }
        }
      });
    } catch (error) {
      console.error('Error fetching game performance:', error);
      res.status(500).json({ message: "Failed to fetch game performance" });
    }
  });

  app.get("/api/admin/analytics/player-activity", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const users = await storage.getUsersWithPlayerInfo();
      
      // Group by registration date (last 7 days)
      const now = new Date();
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(now);
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
      });

      const registrationsByDay = last7Days.map(date => {
        const count = users.filter(u => {
          if (!u.createdAt) return false;
          const userDate = new Date(u.createdAt).toISOString().split('T')[0];
          return userDate === date;
        }).length;
        return { date, count };
      });

      // Player statistics
      const totalPlayers = users.length;
      const activePlayers = users.filter(u => u.playerInfo?.isOnline).length;
      const playersWithBets = users.filter(u => ((u.playerInfo?.totalWins || 0) + (u.playerInfo?.totalLosses || 0)) > 0).length;

      res.json({
        registrationsByDay,
        totalPlayers,
        activePlayers,
        playersWithBets,
        conversionRate: totalPlayers > 0 ? ((playersWithBets / totalPlayers) * 100).toFixed(2) : 0,
      });
    } catch (error) {
      console.error('Error fetching player activity:', error);
      res.status(500).json({ message: "Failed to fetch player activity" });
    }
  });

  app.get("/api/admin/analytics/top-players", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const users = await storage.getUsersWithPlayerInfo();
      
      // Sort by total games played
      const topByGames = [...users]
        .sort((a, b) => {
          const aGames = (a.playerInfo?.totalWins || 0) + (a.playerInfo?.totalLosses || 0);
          const bGames = (b.playerInfo?.totalWins || 0) + (b.playerInfo?.totalLosses || 0);
          return bGames - aGames;
        })
        .slice(0, 10)
        .map(u => ({
          username: u.username,
          totalGames: (u.playerInfo?.totalWins || 0) + (u.playerInfo?.totalLosses || 0),
          wins: u.playerInfo?.totalWins || 0,
          losses: u.playerInfo?.totalLosses || 0,
          winRate: ((u.playerInfo?.totalWins || 0) + (u.playerInfo?.totalLosses || 0)) > 0 
            ? (((u.playerInfo?.totalWins || 0) / ((u.playerInfo?.totalWins || 0) + (u.playerInfo?.totalLosses || 0))) * 100).toFixed(1)
            : 0,
        }));

      // Sort by chips
      const topByChips = [...users]
        .sort((a, b) => (b.playerInfo?.chips || 0) - (a.playerInfo?.chips || 0))
        .slice(0, 10)
        .map(u => ({
          username: u.username,
          chips: u.playerInfo?.chips || 0,
          totalGames: (u.playerInfo?.totalWins || 0) + (u.playerInfo?.totalLosses || 0),
        }));

      res.json({
        topByGames,
        topByChips,
      });
    } catch (error) {
      console.error('Error fetching top players:', error);
      res.status(500).json({ message: "Failed to fetch top players" });
    }
  });

  app.get("/api/admin/analytics/revenue-trend", requireAdmin, async (req: AuthRequest, res) => {
    try {
      const gameManager = (app as any).gameManager;
      const coinTossManager = (app as any).coinTossManager;
      
      // For now, return current stats - in production, you'd query historical data
      let lucky7Stats = { houseProfitTotal: 0, totalWagered: 0 };
      let coinTossStats = { houseProfitTotal: 0, totalWagered: 0 };
      
      if (gameManager && gameManager.getHouseStats) {
        const stats = gameManager.getHouseStats();
        if (stats) lucky7Stats = stats;
      }
      
      if (coinTossManager && coinTossManager.getHouseStats) {
        const stats = coinTossManager.getHouseStats();
        if (stats) coinTossStats = stats;
      }

      // Simulate trend data (in production, query actual historical data)
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
      });

      const revenueTrend = last7Days.map((date, index) => {
        // For the last day, use actual data; for others, simulate
        const isToday = index === 6;
        return {
          date,
          revenue: isToday 
            ? lucky7Stats.houseProfitTotal + coinTossStats.houseProfitTotal
            : Math.floor(Math.random() * 5000) + 1000,
          wagered: isToday
            ? lucky7Stats.totalWagered + coinTossStats.totalWagered
            : Math.floor(Math.random() * 20000) + 5000,
        };
      });

      res.json({ revenueTrend });
    } catch (error) {
      console.error('Error fetching revenue trend:', error);
      res.status(500).json({ message: "Failed to fetch revenue trend" });
    }
  });
}
