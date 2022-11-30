"use strict";

const { Interface } = require("@ethersproject/abi");
const { encodeDeployment, encodeFunction, compileContract } = require("../utils");

const INITIAL_GREETING = "Hello, World!";
const SECOND_GREETING = "How are you?";

async function main() {
  /* -----------------------------
    Deploy
   ----------------------------- */
  const bytecode = compileContract("./smartcontract/contract", "Greeter.sol");

  const calldata = encodeDeployment(bytecode, {
    types: ["string"],
    values: [INITIAL_GREETING],
  });
  console.log(`deploy calldata: 0x${calldata}\n`);

  /* -----------------------------
    Get
   ----------------------------- */
  const sigHash = new Interface(["function greet()"]).getSighash("greet");
  console.log(`get calldata: ${sigHash}\n`);

  /* -----------------------------
    Set
   ----------------------------- */
  const setcalldata = encodeFunction("setGreeting", {
    types: ["string"],
    values: [SECOND_GREETING],
  });
  console.log(`set calldata: ${setcalldata}\n`);
}

main();
