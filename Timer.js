const KAYOTE_TIME = 500;

class Timer {
  constructor(timeLeft = 0, increment = 0, _gameString, _color) {
    this.startTime = 0;
    this.timeLeft = timeLeft;
    this.isRunning = false;
    this.gameString = _gameString;
    this.increment = increment; // New property to hold the increment value
    this.color = _color;
  }

  start() {
    this.isRunning = true;
    this.startTime = Date.now();
  }

  stop() {
    let timeElapsed = Date.now() - this.startTime;
    timeElapsed -= KAYOTE_TIME;
    timeElapsed = Math.max(timeElapsed, 0);
    this.timeLeft -= timeElapsed;
    this.isRunning = false;
    this.addTime(this.increment);
  }

  addTime(milliseconds) {
    this.timeLeft += milliseconds;
    // if (!this.isRunning) {
    //   this.startTime = Date.now();
    // }
  }

  getTimeLeft() {
    if (this.isRunning) {
      let elapsedTime = Date.now() - this.startTime;
      elapsedTime -= KAYOTE_TIME;
      elapsedTime = Math.max(0, elapsedTime);
      const remainingTime = this.timeLeft - elapsedTime;
      return remainingTime;
    }
    return this.timeLeft;
  }

  getTimeLeftString() {
    const remainingTime = this.getTimeLeft();
    const minutes = Math.floor(remainingTime / 60000);
    const seconds = ((remainingTime % 60000) / 1000)
      .toFixed(0)
      .padStart(2, "0");
    const timeString = `${minutes}:${seconds}`;
    return timeString;
  }

  isTimedOut() {
    return this.getTimeLeft() <= 0;
  }

  setTime(timeInMs) {
    this.timeLeft = timeInMs;
    this.startTime = Date.now(); // Update the start time regardless of the timer's state
  }
}

function getWinnerByTime(timer1, timer2) {
  if (!timer1.isTimedOut() && !timer2.isTimedOut()) return null;
  const timer1LeftOverTime = timer1.getTimeLeft();
  const timer2LeftOverTime = timer2.getTimeLeft();

  // Whose time is More negative lost

  const winChar =
    timer1LeftOverTime < timer2LeftOverTime ? timer2.color : timer1.color;
  return winChar;
}

function minsToMillis(minutes) {
  return minutes * 60 * 1000; // 1 minute = 60 seconds = 60,000 milliseconds
}

function secsToMillis(seconds) {
  return seconds * 1000; // 1 second = 1,000 milliseconds
}

function getMillis(minutes, seconds = 0) {
  const millisFromMins = minsToMillis(minutes);
  const millisFromSecs = secsToMillis(seconds);
  return millisFromMins + millisFromSecs;
}

module.exports = {
  Timer,
  minsToMillis,
  secsToMillis,
  getMillis,
  getWinnerByTime,
};
