# Overview

FunRep is a real-time multiplayer casino gaming platform built with React, Express, and Socket.io. The platform features multiple games including Lucky 7 (a card betting game) and Coin Toss. Players join synchronized game rooms where they can place bets before a countdown reveals the result. The application features a comprehensive betting system with virtual chips, user authentication, game history tracking, and immersive audio/visual effects.

# Recent Changes

**November 5, 2025 (Latest)**: Fixed Lucky 7 Rejoin Logic to Match Coin Toss
- **Unlocked Bet Restoration**: Players can now see their unlocked bets after rejoining mid-round
  - When user places bets without locking and exits, then rejoins within betting period, bets are restored
  - Server now fetches active bets from database and sends to client on authentication
  - Client filters activeBets to identify unlocked bets (those not in lockedBets)
  - Unlocked bets are displayed and can be locked or cancelled after rejoin
- **Server-Side State Restoration**: Critical fix to restore unlocked bets to server state
  - Server now restores unlocked bets to `this.unlockedBets` map with new socket ID
  - Ensures lock/cancel operations work correctly after rejoin
  - Auto-refund on disconnect still functions properly
- **Complete Parity with Coin Toss**: Lucky 7 rejoin behavior now matches Coin Toss exactly
  - Same rejoin logic for both locked and unlocked bets
  - Consistent user experience across all games

**November 5, 2025**: Enhanced Admin User Management
- **Password Change Feature**: Added ability for admin to change any user's password
  - New purple key icon button in user list Actions column
  - Password change dialog with validation (minimum 6 characters)
  - Confirms password match before submitting
  - Backend endpoint with bcrypt password hashing for security
  - Works for all users including admin changing their own password
- **Dialog Animation Removal**: Completely removed all animations from dialogs
  - Disabled all slide, fade, and position-change animations
  - Removed transition effects from all dialog buttons
  - Dialogs now open/close instantly without any movement
  - Fixed mouse-over animation issues making dialogs difficult to click
  - Applied consistently across all 6 admin action dialogs (Stats, Status, Funds, Password, Confirm, Alert)
  - Improved usability on both PC and mobile devices

**November 3, 2025**: Implemented house-optimized Lucky 7 result logic
- **Payout Minimization**: System now automatically selects card outcomes that minimize total payout to players
  - Analyzes all active bets (red, black, low, high, lucky7) and calculates payout for each possible outcome
  - Selects outcome category (red-low, red-high, black-low, black-high) with minimum total payout
  - When multiple outcomes tie for minimum payout, uses deterministic tie-breaker (SHA-256 hash of gameId + gameStartTime)
- **Number 7 Protection**: Number 7 can NEVER be selected automatically by the system
  - Excluded from all automatic outcome generation (both with bets and without bets)
  - Can ONLY appear when admin explicitly sets override to "lucky7"
  - Lucky7 bets always lose unless admin forces the result
- **Clear Game Rules**: Comprehensive documentation of color and number range rules
  - Red: hearts ♥ or diamonds ♦ (numbers 1-6, 8-13 only)
  - Black: spades ♠ or clubs ♣ (numbers 1-6, 8-13 only)
  - Low: 1-6, High: 8-13, Lucky 7: only via admin override
  - Payout multipliers: 2x for red/black/low/high, 12x for lucky7
- **Deterministic & Auditable**: All outcome selections are reproducible and logged
  - Tie-breaker seed logged for each round with tied minimum payouts
  - Complete bet analysis and payout calculations logged to console
  - System maintains fairness while maximizing house edge

**November 2, 2025**: Fixed Lucky 7 locked bets and UI improvements
- **Locked Bet Cancellation**: Added ability to cancel locked bets with full refund
  - Players can now cancel locked bets during countdown (similar to Coin Toss)
  - New red cancel button appears when bets are locked
  - Backend handler refunds chips and removes bets from database
  - Client receives 'locked-bets-cancelled' event and updates state
- **Disconnect Cleanup**: Locked and unlocked bets now clear when player leaves Lucky 7
  - Prevents bets from processing if player exits mid-round
  - Server clears both lockedBets and unlockedBets on disconnect
- **Popup Auto-Close**: Win/loss popup now automatically closes after 3 seconds
  - Improves game flow and user experience
  - Players can still manually close popup if needed
- **Display Fix**: Recent results now show "7" instead of "&" for Lucky 7 outcomes
  - Makes results clearer and more readable

**November 2, 2025**: Added Data Reset admin functionality
- **Data Reset Page**: New admin page for managing database resets
  - Three reset options: Game Data Only, User Data Only, Complete Reset
  - Safety confirmations requiring exact phrase input
  - Backend endpoints with authentication middleware
  - Proper deletion order respecting foreign key constraints

**November 2, 2025**: Added WhatsApp-based deposit/withdrawal system
- **Deposit Dialog**: Created user-facing deposit dialog accessible from dashboard header
  - Green "Deposit" button with wallet icon in UserDashboard header
  - Dialog displays configurable message and opens WhatsApp with pre-filled text
  - Fetches settings from public API endpoint for seamless user experience
- **Admin Configuration**: Added deposit settings management in Game Management page
  - Admin can configure WhatsApp number (with country code)
  - Customizable deposit message shown to users before contacting via WhatsApp
  - Settings saved via authenticated admin endpoint
- **Database Schema**: Created deposit_settings table to store WhatsApp configuration
  - Stores whatsappNumber (varchar) and depositMessage (text)
  - Tracks last update timestamp
  - Database table created via db:push command

**October 30, 2025**: Enhanced Lucky 7 game with betting features and instant join
- **Instant Join**: Players can now join mid-round and immediately see countdown/bet if time remains
  - Server sends current game state (countdown, status, card if revealed) when player joins
  - Client syncs state instantly via game-state socket event
  - No more waiting for next round - join and play immediately
- **Repeat and Lock Betting**: 
  - Implemented bet locking system allowing players to lock their bets for the next round
  - Added repeat bet feature to quickly replay previous round's betting strategy
  - Enhanced GameRoom.tsx with unlocked/locked bet state management
  - Added Lock, Cancel, and Repeat buttons visible at all times in grid layout
  - Integrated socket event listeners for bet-placed, bets-locked, and bets-cancelled events

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture
The client is built with React and TypeScript using Vite as the build tool. The UI leverages Radix UI components with Tailwind CSS for styling, providing a cohesive casino-themed design system. State management is handled through Zustand stores for game state, audio controls, and authentication. The application includes Three.js integration for potential 3D visual effects and immersive gaming elements.

## Backend Architecture
The server uses Express.js with Socket.io for real-time multiplayer functionality. Game logic is centralized in a GameManager class that handles room management, synchronized countdowns, and betting mechanics. Session-based authentication is implemented with role-based access control (user/admin). The architecture separates concerns between HTTP routes for authentication/data access and WebSocket events for real-time game interactions.

## Database Design
PostgreSQL database with Drizzle ORM handles data persistence. The schema includes:
- **users**: Authentication credentials and role management
- **players**: Game-specific data including chips balance and statistics
- **games**: Match history and game outcome records
- **bets**: Wagering records for Lucky 7 and Coin Toss games
- **chat_messages**: In-game communication logs
- **deposit_settings**: WhatsApp configuration for deposit/withdrawal system

The design supports tracking bet outcomes, player statistics, complete game audit trails, and flexible deposit management via WhatsApp integration.

## Real-time Communication
Socket.io manages all real-time features including room joining/leaving, synchronized countdowns, simultaneous card reveals, and live chat. Events are structured to maintain game state consistency across all connected clients, ensuring fair gameplay and synchronized experiences.

## Authentication & Authorization
Session-based authentication with bcrypt password hashing provides secure user management. The system supports both regular users and admin roles, with middleware protecting sensitive routes and admin functionality like user management dashboards.

## Audio System
Custom audio management with support for background music, sound effects (card reveals, countdowns, betting actions), and user-controlled muting. Audio files are handled as Vite assets with proper loading and playback controls.

# External Dependencies

## Database Services
- **PostgreSQL**: Primary database for user accounts, game history, betting records, and chat logs
- **Neon Database**: Serverless PostgreSQL provider via `@neondatabase/serverless`

## Real-time Communication
- **Socket.io**: WebSocket library enabling real-time multiplayer game rooms, synchronized events, and live chat functionality

## Authentication & Security
- **bcrypt**: Password hashing for secure user credential storage
- **express-session**: Session management for user authentication state

## UI Framework & Styling
- **Radix UI**: Comprehensive component library providing accessible UI primitives
- **Tailwind CSS**: Utility-first CSS framework for responsive casino-themed styling
- **React Three Fiber**: 3D rendering capabilities for enhanced visual effects

## Development & Build Tools
- **Vite**: Fast build tool and development server with HMR support
- **TypeScript**: Type safety across frontend and backend code
- **Drizzle**: Type-safe SQL ORM with migration support

## State Management & Data Fetching
- **Zustand**: Lightweight state management for game state, audio, and user data
- **TanStack Query**: Server state management and caching for API interactions

## Audio & Assets
- **GLSL shader support**: For advanced visual effects
- **Multi-format audio support**: MP3, OGG, WAV files for game sounds and music