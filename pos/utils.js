"use strict";

const { readFileSync } = require("fs");
const { ec } = require("elliptic");
const EC = new ec("secp256k1");

const now = () => Math.floor(new Date().getTime() / 1000);

const toHexString = (bytes) => {
  return Array.from(bytes, (byte) => {
    return ("0" + (byte & 0xff).toString(16)).slice(-2);
  }).join("");
};

const readWallet = (location) => {
  const buffer = readFileSync(location, "utf8");
  return EC.keyFromPrivate(buffer.toString(), "hex");
};

module.exports = { toHexString, now, readWallet };
