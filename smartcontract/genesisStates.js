"use strict";

const { AccountState } = require("./evm");

const InitalBalance = 1000000;

module.exports = [
  new AccountState("0xbe862ad9abfe6f22bcb087716c7d89a26051f74c", 0, InitalBalance, 200),
  new AccountState("0xbe862ad9abfe6f22bcb087716c7d89a26051f74c", 0, InitalBalance, 100),
  new AccountState("0xbe862ad9abfe6f22bcb087716c7d89a26051f74c", 0, InitalBalance, 300),
];
