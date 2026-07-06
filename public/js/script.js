// Chess game client-side logic
const socket = io();

let selectedGameId = null;
let isSpectator = false;
let availableGames = [];

let draggedElement = null;
let draggedFrom = null;
let playerRole = null;
let gameActive = false;
let currentTurn = 'w';
let currentFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// Client-side chess instance used only for legal-move calculation
const chessClient = new Chess();
let gameStats = {
    moveCount: 0,
    capturedPieces: { white: [], black: [] },
    inCheck: false,
    scores: { white: 0, black: 0 }
};

// Chess piece symbols
const pieces = {
    'K': '♔', 'Q': '♕', 'R': '♖', 'B': '♗', 'N': '♘', 'P': '♙',
    'k': '♚', 'q': '♛', 'r': '♜', 'b': '♝', 'n': '♞', 'p': '♟'
};

// Initialize the game
document.addEventListener('DOMContentLoaded', function() {
    showWelcomeModal();
    createBoard();
    setupEventListeners();
});

// ─── Socket: available games ──────────────────────────────────────────────────
socket.on('availableGames', (games) => {
    updateGamesList(games);
});

// ─── Socket: spectator role ───────────────────────────────────────────────────
socket.on('spectatorRole', () => {
    isSpectator = true;
    playerRole = 'spectator';
    gameActive = true; // spectators need this true so updateBoard renders pieces
    showSpectatorIndicator();
    hideLoadingOverlay();
    showSuccess('Now spectating the game!');
});

// ─── Modal helpers ────────────────────────────────────────────────────────────
function showWelcomeModal() {
    document.getElementById('welcome-modal').style.display = 'flex';
    socket.emit('getAvailableGames');
}

function setupEventListeners() {
    document.getElementById('new-game-btn').addEventListener('click', function() {
        const name = document.getElementById('player-name').value.trim();
        if (name) {
            socket.emit('playerRegistered', { name, action: 'newGame' });
            document.getElementById('welcome-modal').style.display = 'none';
            showLoadingOverlay();
        } else {
            showError('Please enter your name');
        }
    });

    document.getElementById('spectate-btn').addEventListener('click', function() {
        const name = document.getElementById('player-name').value.trim();
        if (name) {
            showSpectateModal();
        } else {
            showError('Please enter your name');
        }
    });

    document.getElementById('back-to-welcome').addEventListener('click', function() {
        document.getElementById('spectate-modal').style.display = 'none';
        document.getElementById('welcome-modal').style.display = 'flex';
    });

    document.getElementById('refresh-games').addEventListener('click', function() {
        socket.emit('getAvailableGames');
        showLoadingGames();
    });

    document.getElementById('player-name').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('new-game-btn').click();
    });
}

function showSpectateModal() {
    document.getElementById('welcome-modal').style.display = 'none';
    document.getElementById('spectate-modal').style.display = 'flex';
    socket.emit('getAvailableGames');
    showLoadingGames();
}

function showLoadingGames() {
    document.getElementById('games-list').innerHTML = '<div class="loading-games">Loading games...</div>';
}

function updateGamesList(games) {
    const gamesList = document.getElementById('games-list');
    availableGames = games;

    if (games.length === 0) {
        gamesList.innerHTML = '<div class="empty-games">No active games available for spectating</div>';
        return;
    }

    gamesList.innerHTML = '';

    games.forEach(game => {
        const gameItem = document.createElement('div');
        gameItem.classList.add('game-item');
        gameItem.dataset.gameId = game.gameId;

        const statusClass = game.gameInProgress ? 'status-active' : 'status-waiting';
        const statusText  = game.gameInProgress ? 'Active'        : 'Waiting';

        gameItem.innerHTML = `
            <div class="game-info">
                <div>
                    <div class="game-players">
                        ${game.players.white || 'Waiting...'} vs ${game.players.black || 'Waiting...'}
                    </div>
                    <div class="game-meta">
                        <span>Game #${game.gameId}</span>
                        <span>Moves: ${game.moveCount}</span>
                        <span>Spectators: ${game.spectatorCount}</span>
                    </div>
                </div>
                <div class="game-status-badge ${statusClass}">${statusText}</div>
            </div>
        `;

        gameItem.addEventListener('click', () => selectGame(game.gameId, gameItem));
        gamesList.appendChild(gameItem);
    });

    // Spectate confirm button
    const spectateButton = document.createElement('button');
    spectateButton.id = 'confirm-spectate';
    spectateButton.className = 'w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg transition-colors mt-4';
    spectateButton.textContent = '👁️ Spectate Selected Game';
    spectateButton.disabled = true;
    spectateButton.style.opacity = '0.5';

    spectateButton.addEventListener('click', function() {
        if (selectedGameId) {
            const name = document.getElementById('player-name').value.trim();
            socket.emit('playerRegistered', { name, action: 'spectate', gameId: selectedGameId });
            document.getElementById('spectate-modal').style.display = 'none';
            isSpectator = true;
            showSpectatorIndicator();
        }
    });

    gamesList.appendChild(spectateButton);
}

function selectGame(gameId, gameElement) {
    document.querySelectorAll('.game-item').forEach(item => item.classList.remove('selected'));
    gameElement.classList.add('selected');
    selectedGameId = gameId;

    const btn = document.getElementById('confirm-spectate');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}

// ─── Loading overlay ──────────────────────────────────────────────────────────
function showLoadingOverlay() {
    document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoadingOverlay() {
    document.getElementById('loading-overlay').style.display = 'none';
}

// ─── Board creation ───────────────────────────────────────────────────────────
/**
 * Creates the 64 squares.
 * When playerRole is 'b' the board is flipped so black's pieces are at the bottom.
 */
function createBoard() {
    const board = document.querySelector('.chessboard');
    board.innerHTML = '';

    const flipped = (playerRole === 'b');

    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            // visual row/col → logical row/col
            const logicalRow = flipped ? 7 - row : row;
            const logicalCol = flipped ? 7 - col : col;

            const square = document.createElement('div');
            square.classList.add('square');
            // light/dark based on logical position so colours stay correct
            square.classList.add((logicalRow + logicalCol) % 2 === 0 ? 'light' : 'dark');
            square.dataset.row = logicalRow;
            square.dataset.col = logicalCol;
            square.dataset.square = String.fromCharCode(97 + logicalCol) + (8 - logicalRow);

            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);
            square.addEventListener('click', handleSquareClick);

            board.appendChild(square);
        }
    }
}

// ─── Board update ─────────────────────────────────────────────────────────────
function updateBoard(fen) {
    const board = document.querySelector('.chessboard');
    const squares = board.querySelectorAll('.square');

    const fenParts  = fen.split(' ');
    const position  = fenParts[0];
    currentTurn     = fenParts[1];

    // Keep the client chess instance in sync so we can query legal moves
    currentFen = fen;
    chessClient.load(fen);

    // Clear all squares (keep last-move highlight — cleared separately)
    squares.forEach(square => {
        square.innerHTML = '';
        square.classList.remove('selected', 'valid-move', 'check');
    });

    // Build a map: algebraic notation → piece char
    const pieceMap = {};
    const rows = position.split('/');
    for (let r = 0; r < 8; r++) {
        let c = 0;
        for (const char of rows[r]) {
            if (isNaN(char)) {
                const notation = String.fromCharCode(97 + c) + (8 - r);
                pieceMap[notation] = char;
                c++;
            } else {
                c += parseInt(char);
            }
        }
    }

    // Place pieces onto the (possibly flipped) squares
    squares.forEach(square => {
        const notation = square.dataset.square;
        const pieceChar = pieceMap[notation];
        if (!pieceChar) return;

        const piece = document.createElement('div');
        piece.classList.add('piece');
        piece.classList.add(pieceChar === pieceChar.toUpperCase() ? 'white' : 'black');
        piece.textContent = pieces[pieceChar];
        piece.draggable = !isSpectator;
        piece.dataset.piece  = pieceChar;
        piece.dataset.square = notation;

        piece.addEventListener('dragstart', handleDragStart);
        piece.addEventListener('dragend',   handleDragEnd);

        square.appendChild(piece);
    });

    updateTurnIndicator();
    updateGameStatus();
}

// ─── Drag & drop ──────────────────────────────────────────────────────────────
function handleDragStart(e) {
    // Spectators can never drag
    if (isSpectator || !gameActive) { e.preventDefault(); return; }

    const piece      = e.target;
    const pieceColor = piece.classList.contains('white') ? 'w' : 'b';

    if (pieceColor !== playerRole || currentTurn !== playerRole) {
        e.preventDefault();
        showError("It's not your turn!");
        return;
    }

    draggedElement = piece;
    draggedFrom    = piece.dataset.square;
    piece.classList.add('dragging');

    // Show legal move dots immediately when the piece is picked up
    highlightValidMoves(draggedFrom);
}

function handleDragEnd(e) {
    if (draggedElement) {
        draggedElement.classList.remove('dragging');
        draggedElement = null;
        draggedFrom    = null;
    }
}

function handleDragOver(e) { e.preventDefault(); }

function handleDrop(e) {
    e.preventDefault();
    if (!draggedElement || !gameActive || isSpectator) return;

    const to = e.currentTarget.dataset.square;
    if (draggedFrom === to) { handleDragEnd(e); return; }

    socket.emit('move', { from: draggedFrom, to, promotion: 'q' });
    handleDragEnd(e);
}

// ─── Click-to-move ────────────────────────────────────────────────────────────
let selectedSquare = null;

function handleSquareClick(e) {
    if (!gameActive || isSpectator) return;

    const square = e.currentTarget;
    const piece  = square.querySelector('.piece');

    if (selectedSquare) {
        const to = square.dataset.square;
        if (selectedSquare !== to) {
            socket.emit('move', { from: selectedSquare, to, promotion: 'q' });
        }
        clearSelection();
    } else if (piece) {
        const pieceColor = piece.classList.contains('white') ? 'w' : 'b';
        if (pieceColor === playerRole && currentTurn === playerRole) {
            selectedSquare = square.dataset.square;
            square.classList.add('selected');
            highlightValidMoves(selectedSquare);
        } else {
            showError("It's not your turn!");
        }
    }
}

function clearSelection() {
    selectedSquare = null;
    document.querySelectorAll('.square.selected, .square.valid-move').forEach(sq => {
        sq.classList.remove('selected', 'valid-move');
    });
    // remove dot indicators
    document.querySelectorAll('.move-dot, .capture-ring').forEach(el => el.remove());
}

// ─── Legal-move highlighting ──────────────────────────────────────────────────
/**
 * Highlights every square the piece on `fromSquare` can legally move to.
 * Empty target squares get a dot; squares with an enemy piece get a ring.
 */
function highlightValidMoves(fromSquare) {
    clearHighlights();

    const moves = chessClient.moves({ square: fromSquare, verbose: true });
    moves.forEach(m => {
        const sq = document.querySelector(`[data-square="${m.to}"]`);
        if (!sq) return;

        sq.classList.add('valid-move');

        if (m.captured) {
            // Enemy piece on that square — show a capture ring
            const ring = document.createElement('div');
            ring.className = 'capture-ring';
            sq.appendChild(ring);
        } else {
            // Empty square — show a small dot
            const dot = document.createElement('div');
            dot.className = 'move-dot';
            sq.appendChild(dot);
        }
    });
}

// ─── Highlights ───────────────────────────────────────────────────────────────
/**
 * Clears selection/valid-move highlights but intentionally preserves last-move
 * so the yellow "last move" squares stay visible until the next move.
 */
function clearHighlights() {
    document.querySelectorAll('.square').forEach(sq => {
        sq.classList.remove('valid-move', 'selected');
    });
    document.querySelectorAll('.move-dot, .capture-ring').forEach(el => el.remove());
}

function clearLastMove() {
    document.querySelectorAll('.square.last-move').forEach(sq => sq.classList.remove('last-move'));
}

function highlightLastMove(move) {
    clearLastMove();
    const from = document.querySelector(`[data-square="${move.from}"]`);
    const to   = document.querySelector(`[data-square="${move.to}"]`);
    if (from) from.classList.add('last-move');
    if (to)   to.classList.add('last-move');
}

// ─── UI updates ───────────────────────────────────────────────────────────────
function updateTurnIndicator() {
    const whiteEl = document.getElementById('white-player-name');
    const blackEl = document.getElementById('black-player-name');
    const turnEl  = document.getElementById('current-turn');

    if (whiteEl) whiteEl.classList.remove('current-turn');
    if (blackEl) blackEl.classList.remove('current-turn');

    if (currentTurn === 'w') {
        if (whiteEl) whiteEl.classList.add('current-turn');
        if (turnEl)  turnEl.textContent = 'White';
    } else {
        if (blackEl) blackEl.classList.add('current-turn');
        if (turnEl)  turnEl.textContent = 'Black';
    }
}

function updateGameStatus() {
    const statusEl    = document.getElementById('game-status');
    const moveCountEl = document.getElementById('move-count');

    if (statusEl) {
        if (gameStats.inCheck) {
            statusEl.textContent = 'Check!';
            statusEl.className   = 'status-indicator status-check';
        } else {
            statusEl.textContent = 'Normal';
            statusEl.className   = 'status-indicator status-normal';
        }
    }
    if (moveCountEl) moveCountEl.textContent = gameStats.moveCount;
}

function updateCapturedPieces() {
    const capturedByWhiteEl = document.getElementById('captured-by-white');
    const capturedByBlackEl = document.getElementById('captured-by-black');

    if (capturedByWhiteEl) {
        capturedByWhiteEl.innerHTML = '';
        // White captured black's pieces — black pieces are lowercase keys
        gameStats.capturedPieces.white.forEach(p => {
            const el = document.createElement('div');
            el.classList.add('captured-piece');
            // p is already the correct key (lowercase for black pieces)
            el.textContent = pieces[p] || pieces[p.toLowerCase()] || p;
            capturedByWhiteEl.appendChild(el);
        });
    }

    if (capturedByBlackEl) {
        capturedByBlackEl.innerHTML = '';
        // Black captured white's pieces — white pieces are uppercase keys
        gameStats.capturedPieces.black.forEach(p => {
            const el = document.createElement('div');
            el.classList.add('captured-piece');
            el.textContent = pieces[p] || pieces[p.toUpperCase()] || p;
            capturedByBlackEl.appendChild(el);
        });
    }
}

function updateScores() {
    const w = document.getElementById('white-score');
    const b = document.getElementById('black-score');
    if (w) w.textContent = gameStats.scores.white;
    if (b) b.textContent = gameStats.scores.black;
}

function updateMoveHistory(san) {
    const moveHistory = document.getElementById('move-history');
    if (!moveHistory) return;

    if (gameStats.moveCount <= 1) moveHistory.innerHTML = '';

    const item = document.createElement('div');
    item.classList.add('move-item');
    item.textContent = `${Math.ceil(gameStats.moveCount / 2)}. ${san}`;
    moveHistory.appendChild(item);
    moveHistory.scrollTop = moveHistory.scrollHeight;
}

// ─── Notifications ────────────────────────────────────────────────────────────
function showNotification(message, type = 'info') {
    const n = document.createElement('div');
    n.classList.add('notification', type);
    n.textContent = message;
    document.body.appendChild(n);

    setTimeout(() => {
        n.style.animation = 'slideOut 0.3s ease-in';
        setTimeout(() => { if (n.parentElement) n.remove(); }, 300);
    }, 3000);
}
function showError(msg)   { showNotification(msg, 'error');   }
function showSuccess(msg) { showNotification(msg, 'success'); }
function showInfo(msg)    { showNotification(msg, 'info');    }

// ─── Spectator / game-id decorators ──────────────────────────────────────────
function showSpectatorIndicator() {
    if (document.querySelector('.spectator-indicator')) return;
    const el = document.createElement('div');
    el.className = 'spectator-indicator';
    el.innerHTML = '👁️ SPECTATING';
    document.body.appendChild(el);
}

function showGameIdDisplay(gameId) {
    if (document.querySelector('.game-id-display')) return;
    const el = document.createElement('div');
    el.className = 'game-id-display';
    el.innerHTML = `Game #${gameId}`;
    document.body.appendChild(el);
}

// ─── Game-over modal ──────────────────────────────────────────────────────────
function showGameOverModal(winner, reason, scores, gameLength, gameDuration) {
    // Remove any existing modal first
    document.querySelectorAll('.modal-overlay.game-over').forEach(m => m.remove());

    const modal = document.createElement('div');
    modal.classList.add('modal-overlay', 'game-over');

    const mins = Math.floor(gameDuration / 60);
    const secs = (gameDuration % 60).toString().padStart(2, '0');

    modal.innerHTML = `
        <div class="modal-content">
            <div class="celebration">${winner === 'draw' ? '🤝' : '🎉'}</div>
            <h2 class="text-2xl font-bold mb-4">
                ${winner === 'draw' ? 'Game Draw!' : `${winner === 'w' ? 'White' : 'Black'} Wins!`}
            </h2>
            <p class="text-gray-600 mb-2">${reason}</p>
            <p class="text-sm text-gray-500 mb-4">
                Moves: ${gameLength} &nbsp;|&nbsp; Time: ${mins}:${secs}
            </p>
            <div class="mb-4 text-sm">
                <strong>Scores — White:</strong> ${scores.white} &nbsp; <strong>Black:</strong> ${scores.black}
            </div>
            <button class="play-again-btn" onclick="location.reload()">Play Again</button>
        </div>
    `;

    document.body.appendChild(modal);

    // Auto-remove after 5 s
    setTimeout(() => { if (modal.parentElement) modal.remove(); }, 5000);
}

// ─── Socket event handlers ────────────────────────────────────────────────────
socket.on('playerRole', (role) => {
    playerRole = role;
    isSpectator = false;
    // Rebuild the board with the correct orientation now that we know our role
    createBoard();
    updateBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    console.log('Assigned role:', role);
});

socket.on('gameId', (gameId) => {
    console.log('Game ID:', gameId);
    showGameIdDisplay(gameId);
});

socket.on('playerNames', (players) => {
    const whiteEl = document.getElementById('white-player-name');
    const blackEl = document.getElementById('black-player-name');

    if (whiteEl) {
        const span = whiteEl.querySelector('span.truncate') || whiteEl.querySelector('span') || whiteEl;
        span.textContent = players.white || 'Waiting...';
    }
    if (blackEl) {
        const span = blackEl.querySelector('span.truncate') || blackEl.querySelector('span') || blackEl;
        span.textContent = players.black || 'Waiting...';
    }
});

socket.on('gameReady', () => {
    hideLoadingOverlay();
    gameActive = true;
    showSuccess('Game started! Both players connected.');
});

socket.on('boardState', (fen) => {
    updateBoard(fen);
});

socket.on('gameStats', (stats) => {
    gameStats.moveCount      = stats.moveCount;
    gameStats.capturedPieces = stats.capturedPieces;
    gameStats.inCheck        = stats.inCheck;
    gameStats.scores         = stats.scores;
    currentTurn              = stats.currentTurn;

    updateGameStatus();
    updateCapturedPieces();
    updateScores();
    updateTurnIndicator();
});

socket.on('move', (data) => {
    gameStats.moveCount++;
    updateMoveHistory(data.san);
    highlightLastMove(data);
});

socket.on('invalidMove', (data) => {
    showError(data.reason || 'Invalid move');
    clearSelection();
});

socket.on('check', (data) => {
    gameStats.inCheck = true;
    updateGameStatus();
    showInfo(`${data.player === 'w' ? 'White' : 'Black'} is in check!`);
});

socket.on('gameOver', (data) => {
    gameActive = false;
    showGameOverModal(data.winner, data.reason, data.scores, data.gameLength, data.gameDuration);
    gameStats.scores = data.scores;
    updateScores();
});

socket.on('playerDisconnected', (data) => {
    gameActive = false;
    showError(`${data.playerName} disconnected`);
    showLoadingOverlay();
});

socket.on('resetGame', () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    gameStats.moveCount = 0;
    gameStats.inCheck   = false;

    // Rebuild the board (preserves current orientation)
    createBoard();
    updateBoard(startFen);

    updateGameStatus();

    const moveHistory = document.getElementById('move-history');
    if (moveHistory) moveHistory.innerHTML = '';

    clearSelection();
});

socket.on('scoresUpdate', (scores) => {
    gameStats.scores = scores;
    updateScores();
});

socket.on('pieceCaptured', (data) => {
    console.log('Piece captured:', data.piece);
});

socket.on('error', showError);

socket.on('connect',    () => showSuccess('Connected to server'));
socket.on('disconnect', () => { showError('Disconnected from server'); gameActive = false; });

socket.on('reconnect', () => {
    showSuccess('Reconnected to server');
    socket.emit('getBoardState');
});

// ─── Initialise board to starting position ───────────────────────────────────
updateBoard('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

// ─── Misc ─────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    const board = document.querySelector('.chessboard');
    if (board) { board.style.width = ''; board.style.height = ''; }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && gameActive) socket.emit('getBoardState');
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearSelection();
});

document.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('beforeunload', () => {
    if (socket.connected) socket.disconnect();
});