import crypto from "crypto";

function generateHash(username) {
  const currentTime = Date.now().toString();

  const combinedString = username + currentTime;

  const hash = crypto.createHash("sha256");
  hash.update(combinedString);

  const hashedResult = hash.digest("hex");

  const twelveDigitHash = hashedResult.slice(0, 12);

  return twelveDigitHash;
}

export { generateHash };
