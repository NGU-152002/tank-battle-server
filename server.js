import { spawn } from 'child_process';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

console.log('🚀 Starting Tank Battle Multiplayer Game...');

// Start Vite dev server
console.log('📦 Starting Vite development server...');
const viteProcess = spawn('npm', ['run', 'dev'], {
  stdio: 'inherit',
  shell: true
});

// Start WebSocket server
console.log('🔌 Starting WebSocket server...');
const server = createServer();
const wss = new WebSocketServer({ server });

// Game state management
let games = new Map();
let players = new Map();

class GameState {
  constructor(gameId) {
    this.gameId = gameId;
    this.players = [];
    this.currentPlayer = 0;
    this.gameState = 'waiting';
    this.projectile = null;
    this.terrain = this.generateTerrain();
    this.tanks = [
      { x: 100, y: 550, color: 'blue', isPlayer: true, health: 100, playerId: 0 },
      { x: 1100, y: 550, color: 'red', isPlayer: false, health: 100, playerId: 1 }
    ];
    this.weaponIndex = 0;
    this.weapons = ['Cannon', 'Missile', 'Napalm', 'Laser'];
    this.weaponDamage = {
      'Cannon': 25,
      'Missile': 40,
      'Napalm': 35,
      'Laser': 50
    };
  }

  generateTerrain() {
    const terrain = [];
    for (let x = 0; x < 1200; x++) {
      const y = 500 + 30 * Math.sin(x * 0.01) + Math.random() * 5;
      terrain.push(y);
    }
    return terrain;
  }

  resetGame() {
    this.tanks = [
      { x: 100, y: 550, color: 'blue', isPlayer: true, health: 100, playerId: 0 },
      { x: 1100, y: 550, color: 'red', isPlayer: false, health: 100, playerId: 1 }
    ];
    this.currentPlayer = 0;
    this.gameState = 'waiting';
    this.projectile = null;
    this.terrain = this.generateTerrain();
    this.weaponIndex = 0;
  }

  simulateProjectile(projectile) {
    let { x, y, vx, vy } = projectile;
    const maxSteps = 200;
    
    for (let step = 0; step < maxSteps; step++) {
      x += vx;
      y += vy;
      vy += 0.2;
      
      if (x < 0 || x > 1200 || y > 600) {
        return { hit: false, x, y };
      }
      
      const terrainX = Math.floor(x);
      if (terrainX >= 0 && terrainX < this.terrain.length && y >= this.terrain[terrainX]) {
        return { hit: false, x, y };
      }
      
      for (let i = 0; i < this.tanks.length; i++) {
        const tank = this.tanks[i];
        const terrainHeight = this.terrain[Math.floor(tank.x)] || 600;
        const tankY = terrainHeight - 20;
        
        if (
          x >= tank.x &&
          x <= tank.x + 40 &&
          y >= tankY - 20 &&
          y <= tankY
        ) {
          return { 
            hit: true, 
            x, 
            y, 
            tankIndex: i,
            damage: this.weaponDamage[this.weapons[this.weaponIndex]] || 20
          };
        }
      }
    }
    
    return { hit: false, x, y };
  }

  getGameData() {
    return {
      gameId: this.gameId,
      currentPlayer: this.currentPlayer,
      gameState: this.gameState,
      projectile: this.projectile,
      terrain: this.terrain,
      tanks: this.tanks,
      weaponIndex: this.weaponIndex,
      weapons: this.weapons,
      weaponDamage: this.weaponDamage
    };
  }
}

wss.on('connection', (ws) => {
  let playerId = null;
  let gameId = null;

  console.log('🎮 New client connected');

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join_game':
          handleJoinGame(ws, data);
          break;
        case 'create_game':
          handleCreateGame(ws, data);
          break;
        case 'move_tank':
          handleMoveTank(ws, data);
          break;
        case 'fire_projectile':
          handleFireProjectile(ws, data);
          break;
        case 'change_weapon':
          handleChangeWeapon(ws, data);
          break;
        case 'reset_game':
          handleResetGame(ws, data);
          break;
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('👋 Client disconnected');
    if (playerId && gameId) {
      handlePlayerDisconnect(playerId, gameId);
    }
  });

  function handleJoinGame(ws, data) {
    const { gameId: requestedGameId } = data;
    const game = games.get(requestedGameId);
    
    if (!game) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Game not found'
      }));
      return;
    }

    if (game.players.length >= 2) {
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Game is full'
      }));
      return;
    }

    playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    gameId = requestedGameId;
    
    game.players.push(playerId);
    players.set(playerId, ws);

    ws.send(JSON.stringify({
      type: 'game_joined',
      playerId: playerId,
      gameId: gameId,
      playerIndex: game.players.length - 1,
      gameData: game.getGameData()
    }));

    broadcastToGame(gameId, {
      type: 'player_joined',
      playerId: playerId,
      playerIndex: game.players.length - 1
    }, null); // Send to ALL players

    console.log(`✅ Player ${playerId} joined game ${gameId}`);
  }

  function handleCreateGame(ws, data) {
    const generatedGameId = `game_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const game = new GameState(generatedGameId);
    
    playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    gameId = generatedGameId;
    
    game.players.push(playerId);
    games.set(generatedGameId, game);
    players.set(playerId, ws);

    ws.send(JSON.stringify({
      type: 'game_created',
      gameId: generatedGameId,
      playerId: playerId,
      playerIndex: 0,
      gameData: game.getGameData()
    }));

    console.log(`🎯 Game ${generatedGameId} created by player ${playerId}`);
  }

  function handleMoveTank(ws, data) {
    const { gameId: requestedGameId, tank, newX } = data;
    const game = games.get(requestedGameId);
    
    if (!game || !game.players.includes(playerId)) {
      return;
    }

    const playerIndex = game.players.indexOf(playerId);
    if (playerIndex !== game.currentPlayer || game.gameState !== 'waiting') {
      return;
    }

    game.tanks[playerIndex].x = newX;

    broadcastToGame(requestedGameId, {
      type: 'tank_moved',
      playerIndex: playerIndex,
      newX: newX
    }, null); // Send to ALL players
  }

  function handleFireProjectile(ws, data) {
    const { gameId: requestedGameId, projectile } = data;
    const game = games.get(requestedGameId);
    
    if (!game || !game.players.includes(playerId)) {
      return;
    }

    const playerIndex = game.players.indexOf(playerId);
    if (playerIndex !== game.currentPlayer || game.gameState !== 'waiting') {
      return;
    }

    // Update game state to firing and store projectile
    game.gameState = 'firing';
    game.projectile = projectile;

    // Broadcast projectile to all players for animation
    broadcastToGame(requestedGameId, {
      type: 'projectile_fired',
      projectile: projectile
    }, null); // Send to ALL players, including the firing player

    // Simulate projectile on server after a longer delay to allow animation
    setTimeout(() => {
      const result = game.simulateProjectile(projectile);
      
      if (result.hit) {
        const tankIndex = result.tankIndex;
        const damage = result.damage;
        
        game.tanks[tankIndex].health = Math.max(0, game.tanks[tankIndex].health - damage);
        
        if (game.tanks[tankIndex].health <= 0) {
          game.gameState = 'gameOver';
        } else {
          game.currentPlayer = (game.currentPlayer + 1) % 2;
          game.gameState = 'waiting';
        }
        
        game.projectile = null;
        
        broadcastToGame(requestedGameId, {
          type: 'tank_hit',
          tankIndex: tankIndex,
          damage: damage,
          newHealth: game.tanks[tankIndex].health,
          gameState: game.gameState,
          currentPlayer: game.currentPlayer
        }, null); // Send to ALL players
      } else {
        game.currentPlayer = (game.currentPlayer + 1) % 2;
        game.gameState = 'waiting';
        game.projectile = null;
        
        broadcastToGame(requestedGameId, {
          type: 'projectile_ended',
          currentPlayer: game.currentPlayer
        }, null); // Send to ALL players
      }
    }, 2000); // Wait 2 seconds for animation to complete
  }

  function handleChangeWeapon(ws, data) {
    const { gameId: requestedGameId, weaponIndex } = data;
    const game = games.get(requestedGameId);
    
    if (!game || !game.players.includes(playerId)) {
      return;
    }

    const playerIndex = game.players.indexOf(playerId);
    if (playerIndex !== game.currentPlayer) {
      return;
    }

    game.weaponIndex = weaponIndex;

    broadcastToGame(requestedGameId, {
      type: 'weapon_changed',
      weaponIndex: weaponIndex
    }, null); // Send to ALL players
  }

  function handleResetGame(ws, data) {
    const { gameId: requestedGameId } = data;
    const game = games.get(requestedGameId);
    
    if (!game || !game.players.includes(playerId)) {
      return;
    }

    game.resetGame();

    broadcastToGame(requestedGameId, {
      type: 'game_reset',
      gameData: game.getGameData()
    }, null); // Send to ALL players
  }

  function handlePlayerDisconnect(disconnectedPlayerId, disconnectedGameId) {
    const game = games.get(disconnectedGameId);
    if (game) {
      game.players = game.players.filter(id => id !== disconnectedPlayerId);
      
      if (game.players.length === 0) {
        games.delete(disconnectedGameId);
        console.log(`🗑️ Game ${disconnectedGameId} removed (no players)`);
      } else {
        broadcastToGame(disconnectedGameId, {
          type: 'player_disconnected',
          playerId: disconnectedPlayerId
        }, null); // Send to ALL players
        console.log(`👋 Player ${disconnectedPlayerId} disconnected from game ${disconnectedGameId}`);
      }
    }
    
    players.delete(disconnectedPlayerId);
  }

  function broadcastToGame(gameId, message, excludePlayerId = null) {
    const game = games.get(gameId);
    if (!game) return;

    console.log(`Broadcasting ${message.type} to game ${gameId}, players:`, game.players, 'excludePlayerId:', excludePlayerId);

    game.players.forEach(playerId => {
      // If excludePlayerId is null, send to ALL players
      // If excludePlayerId is specified, exclude that player
      if (excludePlayerId === null || playerId !== excludePlayerId) {
        const playerWs = players.get(playerId);
        if (playerWs && playerWs.readyState === 1) {
          console.log(`Sending ${message.type} to player ${playerId}`);
          playerWs.send(JSON.stringify(message));
        } else {
          console.log(`Player ${playerId} WebSocket not ready, state:`, playerWs?.readyState);
        }
      } else {
        console.log(`Excluding player ${playerId} from broadcast`);
      }
    });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ WebSocket server running on port ${PORT}`);
  console.log(`🌐 Frontend will be available at http://localhost:5173`);
  console.log(`🎮 Ready for multiplayer tank battles!`);
});

setInterval(() => {
  console.log(`📊 Active games: ${games.size}, Active players: ${players.size}`);
}, 30000); 