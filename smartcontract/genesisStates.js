"use strict";

const { AccountState } = require("./evm");

const InitalBalance = 1000000;

module.exports = [
  new AccountState("0x9e6aba2bfd33c4919171712e25f52d2fae0edcd0", 0, InitalBalance, 200), // alice
  new AccountState("0xeef807463c39ef51a2962ec8e456f04b348589e4", 0, InitalBalance, 100), // bob
  new AccountState("0x4ff752bb652baba2288827ebc71b0bfebff8165a", 0, InitalBalance, 300), // tom
];
