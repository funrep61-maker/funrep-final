import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { sql } from "drizzle-orm";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  role: varchar("role", { length: 20 }).default("user").notNull(),
  status: varchar("status", { length: 20 }).default("active").notNull(), // 'active', 'blocked', 'suspended'
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// Players table for game-specific data
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  socketId: varchar("socket_id", { length: 255 }).notNull(),
  name: text("name").notNull(),
  chips: integer("chips").default(0).notNull(),
  totalWins: integer("total_wins").default(0).notNull(),
  totalLosses: integer("total_losses").default(0).notNull(),
  totalBetsAmount: integer("total_bets_amount").default(0).notNull(),
  isOnline: boolean("is_online").default(false).notNull(),
  lastActivity: timestamp("last_activity").default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Games table for game history
export const games = pgTable("games", {
  id: serial("id").primaryKey(),
  roomId: varchar("room_id", { length: 50 }).notNull(),
  cardNumber: integer("card_number").notNull(),
  cardColor: varchar("card_color", { length: 10 }).notNull(),
  totalBets: integer("total_bets").default(0).notNull(),
  totalPlayers: integer("total_players").notNull(),
  status: varchar("status", { length: 20 }).default("in_progress").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Bets table for betting records
export const bets = pgTable("bets", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => games.id).notNull(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  betAmount: integer("bet_amount").notNull(),
  betType: varchar("bet_type", { length: 20 }).notNull(), // 'red', 'black', 'number', 'high', 'low'
  betValue: varchar("bet_value", { length: 20 }), // specific number or color
  won: boolean("won").notNull(),
  winAmount: integer("win_amount").default(0).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Chat messages table
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  roomId: varchar("room_id", { length: 50 }).notNull(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Andar Bahar matches table for 1v1 games
export const andarBaharMatches = pgTable("andar_bahar_matches", {
  id: serial("id").primaryKey(),
  matchId: varchar("match_id", { length: 50 }).notNull().unique(),
  dealerPlayerId: integer("dealer_player_id").references(() => players.id),
  guesserPlayerId: integer("guesser_player_id").references(() => players.id),
  betAmount: integer("bet_amount").notNull(),
  jokerCardRank: varchar("joker_card_rank", { length: 2 }), // 'A', '2'-'10', 'J', 'Q', 'K'
  jokerCardSuit: varchar("joker_card_suit", { length: 10 }), // 'hearts', 'diamonds', 'clubs', 'spades'
  guesserChoice: varchar("guesser_choice", { length: 10 }), // 'andar' or 'bahar'
  winningSide: varchar("winning_side", { length: 10 }), // 'andar' or 'bahar'
  winnerPlayerId: integer("winner_player_id").references(() => players.id),
  status: varchar("status", { length: 30 }).default("waiting_for_players").notNull(), 
  // 'waiting_for_players', 'placing_bets', 'selecting_dealer', 'revealing_joker', 'choosing_side', 'dealing_cards', 'completed', 'cancelled'
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  completedAt: timestamp("completed_at"),
});

// Coin Toss Games table for coin toss game history
export const coinTossGames = pgTable("coin_toss_games", {
  id: serial("id").primaryKey(),
  roomId: varchar("room_id", { length: 50 }).notNull(),
  result: varchar("result", { length: 10 }).notNull(), // 'heads' or 'tails'
  totalBets: integer("total_bets").default(0).notNull(),
  totalPlayers: integer("total_players").notNull(),
  status: varchar("status", { length: 20 }).default("in_progress").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Coin Toss Bets table for betting records
export const coinTossBets = pgTable("coin_toss_bets", {
  id: serial("id").primaryKey(),
  gameId: integer("game_id").references(() => coinTossGames.id).notNull(),
  playerId: integer("player_id").references(() => players.id).notNull(),
  betAmount: integer("bet_amount").notNull(),
  betType: varchar("bet_type", { length: 10 }).notNull(), // 'heads' or 'tails'
  won: boolean("won").notNull(),
  winAmount: integer("win_amount").default(0).notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Deposit Settings table for WhatsApp deposit/withdraw configuration
export const depositSettings = pgTable("deposit_settings", {
  id: serial("id").primaryKey(),
  whatsappNumber: varchar("whatsapp_number", { length: 20 }).notNull(),
  depositMessage: text("deposit_message").notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

// Schema validation types
export const insertPlayerSchema = createInsertSchema(players).pick({
  userId: true,
  socketId: true,
  name: true,
  chips: true,
});

export const insertGameSchema = createInsertSchema(games).pick({
  roomId: true,
  cardNumber: true,
  cardColor: true,
  totalBets: true,
  totalPlayers: true,
});

export const insertBetSchema = createInsertSchema(bets).pick({
  gameId: true,
  playerId: true,
  betAmount: true,
  betType: true,
  betValue: true,
  won: true,
  winAmount: true,
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).pick({
  roomId: true,
  playerId: true,
  message: true,
});

export const insertAndarBaharMatchSchema = createInsertSchema(andarBaharMatches).pick({
  matchId: true,
  dealerPlayerId: true,
  guesserPlayerId: true,
  betAmount: true,
  jokerCardRank: true,
  jokerCardSuit: true,
  guesserChoice: true,
  winningSide: true,
  winnerPlayerId: true,
  status: true,
});

export const insertCoinTossGameSchema = createInsertSchema(coinTossGames).pick({
  roomId: true,
  result: true,
  totalBets: true,
  totalPlayers: true,
});

export const insertCoinTossBetSchema = createInsertSchema(coinTossBets).pick({
  gameId: true,
  playerId: true,
  betAmount: true,
  betType: true,
  won: true,
  winAmount: true,
});

export const insertDepositSettingsSchema = createInsertSchema(depositSettings).pick({
  whatsappNumber: true,
  depositMessage: true,
});

// Type exports
export type Player = typeof players.$inferSelect;
export type Game = typeof games.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type AndarBaharMatch = typeof andarBaharMatches.$inferSelect;
export type CoinTossGame = typeof coinTossGames.$inferSelect;
export type CoinTossBet = typeof coinTossBets.$inferSelect;
export type DepositSettings = typeof depositSettings.$inferSelect;

export type InsertPlayer = z.infer<typeof insertPlayerSchema>;
export type InsertGame = z.infer<typeof insertGameSchema>;
export type InsertBet = z.infer<typeof insertBetSchema>;
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type InsertAndarBaharMatch = z.infer<typeof insertAndarBaharMatchSchema>;
export type InsertCoinTossGame = z.infer<typeof insertCoinTossGameSchema>;
export type InsertCoinTossBet = z.infer<typeof insertCoinTossBetSchema>;
export type InsertDepositSettings = z.infer<typeof insertDepositSettingsSchema>;
