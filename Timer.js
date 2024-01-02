class Timer {
  constructor(timeLeft = 0) {
    this.startTime = 0;
    this.timeLeft = timeLeft;
    this.timerId = null;
    this.isRunning = false;
  }

  start() {
    if (!this.isRunning) {
      this.startTime = Date.now();
      this.timerId = setTimeout(() => {
        this.stop();
      }, this.timeLeft);
      this.isRunning = true;
    }
  }

  stop() {
    if (this.isRunning) {
      clearTimeout(this.timerId);
      const elapsedTime = Date.now() - this.startTime;
      this.timeLeft -= elapsedTime;
      this.isRunning = false;
    }
  }

  addTime(milliseconds) {
    this.timeLeft += milliseconds;
    if (!this.isRunning) {
      this.startTime = Date.now();
    }
  }

  getTimeLeft() {
    if (this.isRunning) {
      const elapsedTime = Date.now() - this.startTime;
      const remainingTime = this.timeLeft - elapsedTime;
      return remainingTime >= 0 ? remainingTime : 0;
    }
    return this.timeLeft;
  }
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

module.exports = { Timer, minsToMillis, secsToMillis, getMillis };
