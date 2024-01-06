const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { PLAYERSTATUS } = require("./Enums.js");
const { generateHash } = require("./Hash.js");
const { Timer, getMillis, getWinnerByTime } = require("./Timer.js");
const { Chess } = require("chess.js");

let PORT = process.env.PORT || 3000;
const TIMEOUT_CHECK_INTERVAL_TIME = 2000;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());

/* TIMEOUT CHECK FUNCTION*/
const checkForTimeout = () => {
  const toEndGames = []; // [{gameString, winColor}]

  for (let [gameString, gameData] of runningGames) {
    const { whiteTimer, blackTimer } = gameData;
    const winColor = getWinnerByTime(whiteTimer, blackTimer);
    if (winColor != null) {
      toEndGames.push({ gameString, winColor });
    }
  }

  for (let obj of toEndGames) {
    const { gameString, winColor } = obj;
    endGame(gameString, winColor);
  }
};

// ENDS HERE

const idToUsername = new Map();
const openGames = new Map(); // GameString : {}
const runningGames = new Map(); // GameString : {}
const idToInfo = new Map(); // id : => {curGameString, isPlaying, }

// GameString : {chessInstance, WhiteTimer, BlackTimer, WhiteId, BlackId}

const timeOutCheckInterval = setInterval(
  checkForTimeout,
  TIMEOUT_CHECK_INTERVAL_TIME
);

// Server Methods

const unRegisterPlayer = (socketId) => {
  // i.e Disconnected
  const inGame =
    idToInfo.get(socketId) == null ? false : idToInfo.get(socketId).isPlaying;
  const userInfo = idToInfo.get(socketId);
  const gameString = userInfo.curGameString;

  // Game Hasnt begun
  if (openGames.has(gameString)) {
    openGames.delete(gameString);
    idToUsername.delete(socketId);
    idToInfo.delete(socketId);
    return;
  }

  // If Game Started i.e 2 Players Joined
  if (inGame) {
    const gameInfo = runningGames.get(gameString);
    let winColor = "w"; // its opposite of disconnect's color
    if (socketId == gameInfo.whiteId) winColor = "b";
    idToUsername.delete(socketId);
    idToInfo.delete(socketId);
    endGame(gameString, winColor);
  }
};

// Make All Room Members Leave the Room
function clearRoom(roomId) {
  const room = io.sockets.adapter.rooms.get(roomId);
  if (room) {
    for (const socketId of room) {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.leave(roomId);
      }
    }
  }
}
// WinnerChar => w, b, d
const endGame = (gameString, winnerChar) => {
  console.log(`Ending Game ${gameString} WITH RESULT : ${winnerChar}`);

  const gameInfo = runningGames.get(gameString);
  const blackName = gameInfo.blackName;
  const whiteName = gameInfo.whiteName;

  const { whiteId, blackId } = gameInfo;
  let winnerUsername = winnerChar == "b" ? blackName : whiteName;
  const resultData = {
    isDraw: winnerChar == "d",
    winColor: winnerChar != "d" ? winnerChar : null,
    winnerName: winnerChar != "d" ? winnerUsername : null,
  };
  io.to(gameString).emit("endGame", resultData);
  runningGames.delete(gameString);

  // Set Infos Of Players
  setPlayingStatus(whiteId, false);
  setPlayingStatus(blackId, false);

  // Clear Room
  clearRoom(gameString);
};

const setPlayingStatus = (socketId, status, gameString) => {
  if (!idToUsername.get(socketId)) return;
  const curInfo = idToInfo.get(socketId);
  let gameCode = "";
  if (status) gameCode = gameString;
  idToInfo.set(socketId, {
    ...curInfo,
    isPlaying: status,
    curGameString: gameCode,
  });
};

const toggleTimer = (gameData) => {
  const { chessInstance, whiteTimer, blackTimer } = gameData;
  // If it was white's Turn and he made a move, then stop white Timer and start Black Timer
  if (chessInstance.turn() == "b") {
    whiteTimer.stop();
    blackTimer.start();
  } else {
    blackTimer.stop();
    whiteTimer.start();
  }
};

// Server Methods Ends

// Emits
const userRegistered = (socket, userData) => {
  socket.emit("userRegistered", userData);
};
const userRegisterFailed = (socket, msg) => {
  socket.emit("userRegisterFailed", msg);
};
const gameCreated = (socket, gameInfo) => {
  socket.emit("gameCreated", gameInfo);
};
const gameJoinfailed = (socket, msg) => {
  socket.emit("gameJoinFailed", msg);
};
const gameJoined = (socket, gameInfo) => {
  socket.emit("gameJoined", gameInfo);
};
const moveMessage = (
  senderSocket,
  gameString,
  moveObj,
  color,
  blackTime,
  whiteTime
) => {
  const name = idToUsername[senderSocket.id];
  const moveData = {
    senderId: senderSocket.id,
    gameString,
    moveObj,
    senderName: name,
    color,
    blackTime,
    whiteTime,
  };
  io.to(gameString).emit("moveMessage", moveData);
};

const startGame = (gameString) => {
  const gameInfo = runningGames.get(gameString);
  if (!gameInfo) return;
  const whiteName = idToUsername.get(gameInfo.whiteId);
  const blackName = idToUsername.get(gameInfo.blackId);

  const totalTimeInMs = runningGames.get(gameString).totalTimeInMillis;

  const gameData = {
    whiteName: whiteName,
    blackName: blackName,
  };

  setPlayingStatus(gameInfo.whiteId, true, gameString);
  setPlayingStatus(gameInfo.blackId, true, gameString);

  // Start Timers
  const curGame = runningGames.get(gameString);
  curGame.whiteTimer.setTime(totalTimeInMs);
  curGame.blackTimer.setTime(totalTimeInMs);
  curGame.blackTimer.stop();

  curGame.whiteTimer.start();
  io.to(gameString).emit("startGame", gameData);
};
// Emits End

const registerUser = (socket, userData) => {
  const { username } = userData;
  console.log(`Register Req For ${username}`);
  const alreadyDuplicate = idToUsername.has(username);
  if (!username || alreadyDuplicate) {
    userRegisterFailed(socket, { msg: "Name Already Taken." });
    return;
  }
  idToUsername.set(socket.id, username);
  console.log(`${username} Registered`);
  userRegistered(socket, { username });
};

const createGame = (socket, gameData) => {
  const { isPublic, showEval, totalTime, timeIncrement, targetOpponent } =
    gameData;
  const username = idToUsername.get(socket.id);

  const gameString = generateHash(username);
  const gameInfo = {
    creator: username,
    isPublic: isPublic,
    showEval: showEval,
    totalTime: totalTime,
    timeIncrement: timeIncrement,
    targetOpponent: targetOpponent,
    gameString: gameString,
    creatorColor: Math.random() < 0.5 ? "w" : "b",
    creatorId: socket.id,
  };
  openGames.set(gameString, gameInfo);

  // Update Player Status
  setPlayingStatus(socket.id, true, gameString);

  // Create Room
  socket.join(gameString);

  // Send Back To user
  gameCreated(socket, gameInfo);
};

const joinGame = (socket, gameData) => {
  if (idToUsername.get(socket.id) == null) {
    gameJoinfailed(socket, { msg: "Invalid username." });
    return;
  }
  const { gameString } = gameData;
  const gameInfo = openGames.get(gameString);
  const joinerName = idToUsername.get(socket.id);

  if (
    !gameInfo ||
    (gameInfo.targetOpponent && gameInfo.targetOpponent != joinerName)
  ) {
    gameJoinfailed(socket, { msg: "Game already Started or doesnt Exist." });
    return;
  }

  const joinedId = socket.id;
  console.log(`Join request By ${joinerName} to ${gameString}`);

  // Assigning Colors

  const joinerColor = gameInfo.creatorColor == "w" ? "b" : "w";

  /*
  const gameInfo = {
    creator: username,
    isPublic: isPublic,
    showEval: showEval,
    totalTime: totalTime,
    timeIncrement: timeIncrement,
    targetOpponent: targetOpponent,
    gameString: gameString,
    creatorColor: Math.random() < 0.5 ? "w" : "b",
    creatorId: socket.id,
  };
  */

  let whiteId, blackId;

  if (gameInfo.creatorColor == "w") {
    whiteId = gameInfo.creatorId;
    blackId = joinedId;
  } else {
    whiteId = joinedId;
    blackId = gameInfo.creatorId;
  }

  const totalTimeInMillis = getMillis(gameInfo.totalTime);
  const incrementAmountInMillis = getMillis(0, gameInfo.timeIncrement);
  console.log(`Started Game INC TIME(ms) : ${incrementAmountInMillis}`);
  openGames.delete(gameString);

  const whiteTimer = new Timer(
    totalTimeInMillis,
    incrementAmountInMillis,
    gameString,
    "w"
  );
  const blackTimer = new Timer(
    totalTimeInMillis,
    incrementAmountInMillis,
    gameString,
    "b"
  );

  const whiteName = idToUsername.get(whiteId);
  const blackName = idToUsername.get(blackId);
  runningGames.set(gameString, {
    chessInstance: new Chess(),
    whiteTimer,
    blackTimer,
    whiteId,
    blackId,
    whiteName,
    blackName,
    totalTimeInMillis,
  });

  const joinedGameInfo = {
    ...gameInfo,
    myColor: joinerColor,
    opponentName: gameInfo.creator,
  };

  setPlayingStatus(socket.id, true, gameString);

  socket.join(gameString);
  gameJoined(socket, joinedGameInfo);
  startGame(gameString);
  console.log("Game Joined.");
};

const sendMove = (socket, moveData) => {
  if (!moveData || !moveData.gameString) return;
  const { gameString, moveObj, color } = moveData;
  const gameData = runningGames.get(gameString);
  if (!gameData) return;
  const { chessInstance, whiteTimer, blackTimer, whiteId, blackId } = gameData;
  if (chessInstance.turn() != color) return;
  if (socket.id != whiteId && socket.id != blackId) return;
  if (!isValidMove(chessInstance, moveObj)) return;

  // Change Timer
  toggleTimer(gameData);

  // Move if valid Move
  chessInstance.move(moveObj);

  moveMessage(
    socket,
    gameString,
    moveObj,
    color,
    whiteTimer.getTimeLeft(),
    blackTimer.getTimeLeft()
  );

  if (chessInstance.isDraw()) {
    endGame(gameString, "d");
    return;
  } else if (chessInstance.isCheckmate()) {
    const winner = chessInstance.turn() == "w" ? "b" : "w";
    endGame(gameString, winner);
    return;
  }
};

io.on("connection", (socket) => {
  socket.on("registerUser", (userData) => registerUser(socket, userData));
  socket.on("createGame", (data) => createGame(socket, data));
  socket.on("joinGame", (gameData) => joinGame(socket, gameData));
  socket.on("sendMove", (moveData) => {
    sendMove(socket, moveData);
  });
  socket.on("disconnect", () => {
    const username = idToUsername.get(socket.id);
    if (!username) return;
    const userInfo = idToInfo.get(socket.id);
    if (!userInfo || !userInfo.isPlaying || !userInfo.isPlaying) {
      idToUsername.delete(socket.id);
      idToInfo.delete(socket.id);
      console.log(`${idToUsername.size} Players Online Now.`);
      return;
    }
    if (username) console.log(`${username} disconnected.`);
    if (!username || !userInfo) {
      return;
    }
    unRegisterPlayer(socket.id);
    console.log(`${idToUsername.size} Players Online Now.`);
  });
});

server.listen(PORT, () => {
  console.log(`server running at http://localhost:${PORT}`);
});

app.get("/test", (req, res) => {
  // Health Check
  res.status(200).send("200 OK");
});

app.get("/serverInfo", (req, res) => {
  const serverInfo = { playersOnline: idToUsername.size + 1 };
  res.status(200).send(serverInfo);
});

const isValidMove = (chessInstance, moveObj) => {
  const gameCopy = new Chess(); // Create a new instance
  gameCopy.load(chessInstance.fen()); // Load the position from the original instance

  const move = gameCopy.move(moveObj);

  if (move === null) {
    console.log("Invalid Move");
    return false;
  }
  return true;
};

// Debugging
