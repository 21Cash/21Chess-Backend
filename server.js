const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const { generateHash } = require("./Hash.js");
const { Timer, getMillis, getWinnerByTime } = require("./Timer.js");
const { Chess } = require("chess.js");
const { timeStamp } = require("console");

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
    endGame(gameString, winColor, "Timeout");
  }
};

// ENDS HERE
const usernameToSocket = new Map();
const idToUsername = new Map();
const openGames = new Map(); // GameString : {}
const runningGames = new Map(); // GameString : {}
const idToInfo = new Map(); // id : => {curGameString, isPlaying}
const challengeMap = new Map(); // {challengeString : {player1, player2, totalTimeInSecs, incrementTimeInSecs}}
// GameString : {chessInstance, WhiteTimer, BlackTimer, WhiteId, BlackId}

const timeOutCheckInterval = setInterval(
  checkForTimeout,
  TIMEOUT_CHECK_INTERVAL_TIME
);

// Server Methods

const startGame = (gameString) => {
  const gameInfo = runningGames.get(gameString);
  if (!gameInfo) return;
  const whiteName = idToUsername.get(gameInfo.whiteId);
  const blackName = idToUsername.get(gameInfo.blackId);

  const totalTimeInSecs = runningGames.get(gameString).totalTimeInSecs;
  const incrementTimeInSecs = runningGames.get(gameString).incrementTimeInSecs;
  const totalTimeInMs = getMillis(0, totalTimeInSecs);

  const gameData = {
    whiteName: whiteName,
    blackName: blackName,
    totalTimeInSecs,
    incrementTimeInSecs,
    gameString,
    evalGame: gameInfo.evalGame,
  };

  setPlayingStatus(gameInfo.whiteId, true, gameString);
  setPlayingStatus(gameInfo.blackId, true, gameString);

  // Start Timers
  const curGame = runningGames.get(gameString);
  curGame.whiteTimer.setTime(totalTimeInMs);
  curGame.blackTimer.setTime(totalTimeInMs);

  const timeControlString = `${curGame.totalTimeInSecs}+${curGame.incrementTimeInSecs}`;
  // Set Game Header
  gameInfo.chessInstance.header(
    "White",
    whiteName,
    "Black",
    blackName,
    "Date",
    getCurrentDateString(),
    "Site",
    "21Chess.vercel.app",
    "Event",
    "21Chess Casual",
    "TimeControl",
    timeControlString
  );
  curGame.whiteTimer.start();

  console.log(`Starting Game : ${gameString}`);
  io.to(gameString).emit("startGame", gameData);
};

// Server Method to Start Game Between 2 Players
const serverStartGame = (
  socketId1,
  socketId2,
  totalTimeInSecs,
  incrementTimeInSecs,
  evalGame = false
) => {
  const name1 = idToUsername.get(socketId1);
  const name2 = idToUsername.get(socketId2);
  if (!name1 || !name2) {
    console.error(`INTERNAL SERVER ERROR, Invalid Socket Id(s).`);
    return;
  }

  const player1Color = Math.random() < 0.5 ? "w" : "b";
  const player2Color = player1Color == "w" ? "b" : "w";

  const whiteId = player1Color == "w" ? socketId1 : socketId2;
  const blackId = player2Color == "b" ? socketId2 : socketId1;

  const totalTimeInMillis = getMillis(0, totalTimeInSecs);
  const incrementTimeInMillis = getMillis(0, incrementTimeInSecs);
  const gameString = generateHash(name1);

  const whiteTimer = new Timer(
    totalTimeInMillis,
    incrementTimeInMillis,
    gameString,
    "w"
  );
  const blackTimer = new Timer(
    totalTimeInMillis,
    incrementTimeInMillis,
    gameString,
    "b"
  );

  runningGames.set(gameString, {
    chessInstance: new Chess(),
    whiteTimer,
    blackTimer,
    whiteId,
    blackId,
    whiteName: idToUsername.get(whiteId),
    blackName: idToUsername.get(blackId),
    totalTimeInSecs,
    incrementTimeInSecs,
    totalTimeInMillis,
    evalGame,
  });

  const player1GameInfo = {
    myColor: player1Color,
    opponentName: idToUsername.get(socketId2),
    gameString,
    totalTimeInSecs,
    incrementTimeInSecs,
    evalGame,
  };
  const player2GameInfo = {
    myColor: player2Color,
    opponentName: idToUsername.get(socketId1),
    gameString,
    totalTimeInSecs,
    incrementTimeInSecs,
    evalGame,
  };

  const socketRef1 = usernameToSocket.get(idToUsername.get(socketId1));
  const socketRef2 = usernameToSocket.get(idToUsername.get(socketId2));

  socketRef1.join(gameString);
  socketRef2.join(gameString);
  console.log(`Server Game Started ${gameString}`);

  io.to(socketId1).emit("ServerGame", player1GameInfo);
  io.to(socketId2).emit("ServerGame", player2GameInfo);
  setTimeout(() => startGame(gameString), 1000);
};

const unRegisterPlayer = (socketId) => {
  // i.e Disconnected
  const inGame =
    idToInfo.get(socketId) == null ? false : idToInfo.get(socketId).isPlaying;
  const userInfo = idToInfo.get(socketId);
  const gameString = userInfo.curGameString;

  const username = idToUsername.get(socketId);
  // Game Hasnt begun
  if (openGames.has(gameString)) {
    openGames.delete(gameString);

    idToUsername.delete(socketId);
    idToInfo.delete(socketId);
    usernameToSocket.delete(username);
    return;
  }

  // If Game Started i.e 2 Players Joined
  if (inGame) {
    const gameInfo = runningGames.get(gameString);
    let winColor = "w"; // its opposite of disconnect's color
    if (socketId == gameInfo.whiteId) winColor = "b";
    idToUsername.delete(socketId);
    idToInfo.delete(socketId);
    usernameToSocket.delete(username);
    endGame(gameString, winColor);
  }
};

// Make All Room Members Leave the Room
function clearRoom(roomId) {
  console.log(`Clearing Room : ${roomId}`);
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
const endGame = (gameString, winnerChar, cause = null) => {
  // Cause => Resignation, Timeout, ...
  console.log(`Ending Game ${gameString} WITH RESULT : ${winnerChar}`);

  const gameInfo = runningGames.get(gameString);
  if (!gameInfo) return; // Already Ended

  const blackName = gameInfo.blackName;
  const whiteName = gameInfo.whiteName;

  console.log(
    `WINCHAR : ${winnerChar} BLACKNAME : ${blackName}, WHITENAME : ${whiteName}`
  );

  const { whiteId, blackId } = gameInfo;

  const resultString =
    winnerChar == "d" ? "1/2-1/2" : winnerChar == "w" ? "1-0" : "0-1";

  gameInfo.chessInstance.header("result", resultString);

  let winnerUsername = winnerChar == "b" ? blackName : whiteName;
  const resultData = {
    isDraw: winnerChar == "d",
    winColor: winnerChar != "d" ? winnerChar : null,
    winnerName: winnerChar != "d" ? winnerUsername : null,
    cause,
    pgn: gameInfo.chessInstance.pgn(),
  };
  io.to(gameString).emit("endGame", resultData);
  runningGames.delete(gameString);

  // Set Infos Of Players
  setPlayingStatus(whiteId, false);
  setPlayingStatus(blackId, false);

  // Clear Room
  setTimeout(() => clearRoom(gameString), 60000); // delay Room Clear by 30 Secs
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

// Server method to make game req
const makeGameRequest = (
  fromName,
  toName,
  totalTimeInSecs,
  incrementTimeInSecs,
  evalGame = false
) => {
  const player1IsPlaying = idToInfo.get(
    usernameToSocket.get(fromName).id
  ).isPlaying;
  const player2IsPlaying = idToInfo.get(
    usernameToSocket.get(toName).id
  ).isPlaying;

  if (player1IsPlaying || player2IsPlaying) {
    console.log(`Game Req Failed between ${fromName} and ${toName}`);
    return;
  }

  const challengeString = generateHash(fromName);

  const targetSocket = usernameToSocket.get(toName);
  const reqData = {
    senderName: fromName,
    totalTimeInSecs,
    incrementTimeInSecs,
    challengeString,
    player1: fromName,
    player2: toName,
    evalGame,
  };
  challengeMap.set(challengeString, reqData);
  // Expire the Challenge in 15 seconds
  setTimeout(() => {
    if (challengeMap.get(challengeString) != null) {
      challengeMap.delete(challengeString);
    }
  }, 15000);
  targetSocket.emit("gameRequest", reqData);
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
  whiteTime,
  blackTime,
  fen
) => {
  const name = idToUsername[senderSocket.id];
  const { whiteName, blackName } = runningGames.get(gameString);
  const moveData = {
    senderId: senderSocket.id,
    gameString,
    moveObj,
    senderName: name,
    color,
    blackTime,
    whiteTime,
    whiteName,
    blackName,
    fen,
  };
  io.to(gameString).emit("moveMessage", moveData);
};

// Emits End

const registerUser = (socket, userData) => {
  const { username } = userData;
  console.log(`Register Req For ${username}`);
  const alreadyDuplicate = usernameToSocket.has(username);
  if (!username || alreadyDuplicate) {
    userRegisterFailed(socket, { msg: "Name Already Taken." });
    return;
  }

  idToUsername.set(socket.id, username);
  idToInfo.set(socket.id, {
    curGameString: "",
    isPlaying: false,
  });

  socket.join("Global");
  console.log(`${username} Registered`);
  usernameToSocket.set(username, socket);
  userRegistered(socket, { username });
};

const createGame = (socket, gameData) => {
  const { isPublic, showEval, totalTime, timeIncrement, targetOpponent } =
    gameData;
  let evalGame = false;
  if (gameData.evalGame != null && gameData.evalGame)
    evalGame = gameData.evalGame;

  const username = idToUsername.get(socket.id);
  if (!username) return;

  if (targetOpponent != "" && usernameToSocket.has(targetOpponent)) {
    // Make Game req
    makeGameRequest(
      username,
      targetOpponent,
      totalTime * 60,
      timeIncrement,
      evalGame
    );
    return;
  }

  const gameString = generateHash(username);
  const gameInfo = {
    creator: username,
    isPublic: isPublic,
    showEval: showEval,
    totalTime: totalTime, // In Minutes
    timeIncrement: timeIncrement, // In Secs
    targetOpponent: targetOpponent,
    gameString: gameString,
    creatorColor: Math.random() < 0.5 ? "w" : "b",
    creatorId: socket.id,
    evalGame,
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

  const totalTimeInMillis = getMillis(gameInfo.totalTime, 0);
  const incrementAmountInMillis = getMillis(0, gameInfo.timeIncrement);
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
  const totalTimeInSecs = 60 * gameInfo.totalTime;
  let evalGame = false;
  if (gameInfo.evalGame != null && gameInfo.evalGame)
    evalGame = gameInfo.evalGame;
  runningGames.set(gameString, {
    chessInstance: new Chess(),
    whiteTimer,
    blackTimer,
    whiteId,
    blackId,
    whiteName,
    blackName,
    totalTimeInSecs,
    incrementTimeInSecs: gameInfo.timeIncrement,
    totalTimeInMillis,
    evalGame,
  });

  const joinedGameInfo = {
    gameString,
    myColor: joinerColor,
    opponentName: gameInfo.creator,
    totalTimeInSecs,
    incrementTimeInSecs: gameInfo.timeIncrement,
  };

  setPlayingStatus(socket.id, true, gameString);

  socket.join(gameString);
  gameJoined(socket, joinedGameInfo);
  startGame(gameString);
  console.log("Game Joined.");
};

const sendMove = (socket, moveData) => {
  if (!moveData) return;
  const { moveObj, color } = moveData;
  const gameString = idToInfo.get(socket.id).curGameString;
  if (!gameString) {
    console.error(`Internal Error Game String Not Found.`);
    return;
  }
  const gameData = runningGames.get(gameString);
  if (!gameData) return;
  const { chessInstance, whiteTimer, blackTimer, whiteId, blackId } = gameData;
  if (chessInstance.turn() != color) return;
  if (socket.id != whiteId && socket.id != blackId) return;

  const senderName = idToUsername.get(socket.id);
  const senderColor = gameData.whiteName == senderName ? "w" : "b";
  if (chessInstance.turn() != senderColor) {
    console.log(`Move Failed. Username Match failed.`);
    return;
  }

  if (!isValidMove(chessInstance, moveObj)) {
    console.log(`Invalid Move Sent by : ${idToUsername.get(socket.id)}`);
    return;
  }

  if (chessInstance.history().length <= 1) {
    blackTimer.setTime(gameData.totalTimeInMillis);
    whiteTimer.setTime(gameData.totalTimeInMillis);
  }

  // Check For timeouts
  if (getWinnerByTime(whiteTimer, blackTimer) != null) {
    const winChar = getWinnerByTime(whiteTimer, blackTimer);
    endGame(gameString, winChar, "Timeout");
    return;
  }

  // Move if valid Move
  const fullMoveObj = chessInstance.move(moveObj);

  // Change Timer
  toggleTimer(gameData);

  moveMessage(
    socket,
    gameString,
    fullMoveObj,
    color,
    whiteTimer.getTimeLeft(),
    blackTimer.getTimeLeft(),
    chessInstance.fen()
  );

  if (chessInstance.isDraw()) {
    endGame(gameString, "d");
    return;
  } else if (chessInstance.isCheckmate()) {
    const winner = chessInstance.turn() == "w" ? "b" : "w";
    endGame(gameString, winner, "Checkmate");
    return;
  }
};

const socketDisconnect = (socket) => {
  const username = idToUsername.get(socket.id);
  if (!username) return;
  const userInfo = idToInfo.get(socket.id);
  if (!userInfo || !userInfo.isPlaying || !userInfo.isPlaying) {
    const name = idToUsername.get(socket.id);
    idToUsername.delete(socket.id);
    idToInfo.delete(socket.id);
    usernameToSocket.delete(name);
    console.log(`${idToUsername.size} Players Online Now.`);
    return;
  }
  if (username) console.log(`${username} disconnected.`);
  if (!username || !userInfo) {
    return;
  }
  unRegisterPlayer(socket.id);
  socket.leave("Global");
  console.log(`${idToUsername.size} Players Online Now.`);
};

const playerResign = (socket) => {
  const playerInfo = idToInfo.get(socket.id);
  if (!playerInfo || !playerInfo.isPlaying) return;

  const gameString = playerInfo.curGameString;
  const gameInfo = runningGames.get(gameString);
  if (!gameInfo) return;

  const winnerColor = gameInfo.whiteId == socket.id ? "b" : "w";
  endGame(gameString, winnerColor, "Resignation");
};

const registerSpectator = (socket, toJoinGameData) => {
  let { gameString } = toJoinGameData;
  const username = idToUsername.get(socket.id);
  let game = runningGames.get(gameString);

  if (!game) {
    // trying to spectate Player
    const reqSocket = usernameToSocket.get(gameString);
    if (reqSocket) {
      const reqUserGameString = idToInfo.get(reqSocket.id).curGameString;
      if (reqUserGameString != "") gameString = reqUserGameString;
      game = runningGames.get(reqUserGameString);
    }
  }

  console.log(`Spec req By ${username} For ${gameString}`);
  if (!game || !username || !gameString) {
    socket.emit("spectatorRegisterFailed", {
      msg: `${!username ? `User not Resgistered.` : `Invalid Code`}`,
    });
    return;
  }
  socket.join(gameString);

  const gameData = {
    whiteName: game.whiteName,
    blackName: game.blackName,
    gameString,
    fen: game.chessInstance.fen(),
    whiteTime: game.whiteTimer.getTimeLeft(),
    blackTime: game.blackTimer.getTimeLeft(),
  };
  socket.emit("spectatorRegistered", gameData);
};

const gameRequest = (socket, data) => {
  if (!data || !data.targetName) return;
  const { targetName, totalTimeInSecs, incrementTimeInSecs } = data;
  let evalGame = false;
  if (data.evalGame != null && data.evalGame) evalGame = data.evalGame;
  const validTargetName = usernameToSocket.has(targetName);
  const senderName = idToUsername.get(socket.id);
  const senderId = socket.id;
  if (!validTargetName || !senderName) return;
  if (senderName == targetName) return;

  makeGameRequest(
    senderName,
    targetName,
    totalTimeInSecs,
    incrementTimeInSecs,
    evalGame
  );
};

const gameRequestAccept = (socket, data) => {
  if (!data || !data.challengeString) return;
  const { challengeString } = data;

  const challengeData = challengeMap.get(challengeString);
  if (challengeData == null) return;
  const { player1, player2, totalTimeInSecs, incrementTimeInSecs } =
    challengeData;
  let evalGame = false;
  if (challengeData.evalGame) evalGame = challengeData.evalGame;
  serverStartGame(
    usernameToSocket.get(player1).id,
    usernameToSocket.get(player2).id,
    totalTimeInSecs,
    incrementTimeInSecs,
    evalGame
  );

  challengeMap.delete(challengeString);
};

const sendChatMessage = (socket, msgData) => {
  if (!msgData || !msgData.roomName || !msgData.msg) return;
  const { roomName, msg } = msgData;
  const username = idToUsername.get(socket.id);
  const roomExists = io.sockets.adapter.rooms.has(roomName);
  if (!roomExists) return;

  io.to(roomName).emit("chatMessage", {
    roomName,
    sender: username,
    msg,
    timeStamp: Date.now,
  });
};

io.on("connection", (socket) => {
  socket.on("registerUser", (userData) => registerUser(socket, userData));
  socket.on("registerSpectator", (toJoinGameData) =>
    registerSpectator(socket, toJoinGameData)
  );
  socket.on("createGame", (data) => createGame(socket, data));
  socket.on("joinGame", (gameData) => joinGame(socket, gameData));
  socket.on("sendMove", (moveData) => {
    sendMove(socket, moveData);
  });
  socket.on("disconnect", () => socketDisconnect(socket));
  socket.on("resign", () => playerResign(socket));
  socket.on("gameRequest", (reqData) => gameRequest(socket, reqData));
  socket.on("gameRequestAccept", (reqData) =>
    gameRequestAccept(socket, reqData)
  );
  socket.on("sendChatMessage", (msgData) => sendChatMessage(socket, msgData));
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
  try {
    const gameCopy = new Chess(); // Create a new instance
    gameCopy.load(chessInstance.fen()); // Load the position from the original instance

    const move = gameCopy.move(moveObj);

    if (move === null) {
      console.log("Invalid Move");
      return false;
    }
    return true;
  } catch (err) {
    console.log(`Error Occured`);
    return false;
  }
  return false;
};

// Utils

const getCurrentDateString = () => {
  const today = new Date();

  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0"); // Month is zero-indexed, so adding 1
  const day = String(today.getDate()).padStart(2, "0");

  const formattedDate = `${year}-${month}-${day}`;
  return formattedDate;
};
