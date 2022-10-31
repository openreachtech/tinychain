"use strict";

const Blockchain = require("@ethereumjs/blockchain");
const { Chain, Common, Hardfork } = require("@ethereumjs/common");
const EEI = require("@ethereumjs/vm");
const EVM = require("@ethereumjs/evm");
const DefaultStateManager = require("@ethereumjs/statemanager");


// export interface EEIInterface extends EVMStateAccess {
//   getBlockHash(num: bigint): Promise<bigint>
//   storageStore(address: Address, key: Buffer, value: Buffer): Promise<void>
//   storageLoad(address: Address, key: Buffer, original: boolean): Promise<Buffer>
//   copy(): EEIInterface
// }

class EEI {
  constructor() {
  }

  async getBlockHash() {
    return BigInt(1);
  }

  
}

// Note: in a future release there will be an EEI default implementation
// which will ease standalone initialization
const main = async () => {
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.London });
  const stateManager = new DefaultStateManager();
  const blockchain = await Blockchain.create();
  const eei = new EEI(stateManager, common, blockchain);

  const evm = new EVM({
    common,
    eei,
  });

  const STOP = "00";
  const ADD = "01";
  const PUSH1 = "60";

  // Note that numbers added are hex values, so '20' would be '32' as decimal e.g.
  const code = [PUSH1, "03", PUSH1, "05", ADD, STOP];

  evm.events.on("step", function (data) {
    // Note that data.stack is not immutable, i.e. it is a reference to the vm's internal stack object
    console.log(`Opcode: ${data.opcode.name}\tStack: ${data.stack}`);
  });

  evm
    .runCode({
      code: Buffer.from(code.join(""), "hex"),
      gasLimit: BigInt(0xffff),
    })
    .then((results) => {
      console.log(`Returned: ${results.returnValue.toString("hex")}`);
      console.log(`gasUsed: ${results.executionGasUsed.toString()}`);
    })
    .catch(console.error);
};

void main();
