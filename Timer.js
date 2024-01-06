const KAYOTE_TIME = 200;

class Timer {
  constructor(timeLeft = 0, increment = 0) {
    this.startTime = 0;
    this.timeLeft = timeLeft;
    this.timerId = null;
    this.isRunning = false;
    this.increment = increment; // New property to hold the increment value
  }

  startHelper() {
    if (!this.isRunning) {
      this.startTime = Date.now();
      this.timerId = setTimeout(() => {
        this.stop();
      }, this.timeLeft);
      this.isRunning = true;
    }
  }

  start() {
    setTimeout(this.startHelper.bind(this), KAYOTE_TIME); // Ensure proper binding of this
  }

  stop() {
    if (this.isRunning) {
      clearTimeout(this.timerId);
      const elapsedTime = Date.now() - this.startTime;
      this.timeLeft -= elapsedTime;
      this.timeLeft += this.increment; // Increment the timeLeft by the increment value
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

  getTimeLeftString() {
    const remainingTime = this.getTimeLeft();
    const minutes = Math.floor(remainingTime / 60000);
    const seconds = ((remainingTime % 60000) / 1000)
      .toFixed(0)
      .padStart(2, "0");
    const timeString = `${minutes}:${seconds}`;
    return timeString;
  }

  setTime(timeInMs) {
    this.timeLeft = timeInMs;
    this.startTime = Date.now(); // Update the start time regardless of the timer's state
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
