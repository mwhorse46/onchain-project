import Block from './Block';
import {fromJSON} from './Block';
import {rerender} from "../store";
import {publish, subscribeTo} from "../network";
import {maxBy, reduce, unfold, reverse, values, prop} from "ramda";

class Blockchain {
  constructor(name) {
    this.name = name;
    this.genesis = null;
    this.blocks = {};

    this.createGenesisBlock();

    subscribeTo('BLOCKS_BROADCAST', ({ blocks, blockchainName }) => {
      if (blockchainName === this.name) {
        blocks.forEach(block => this._addBlock(fromJSON(this, block)))
      }
    })

    publish('REQUEST_BLOCKS', { blockchainName: this.name })
    subscribeTo('REQUEST_BLOCKS', ({ blockchainName }) => {
      if (blockchainName === this.name)
        publish('BLOCKS_BROADCAST', { blockchainName, blocks: Object.values(this.blocks).map(b => b.toJSON())})
    })
  }

  maxHeightBlock() {
    const blocks = values(this.blocks)
    const maxByHeight = maxBy(prop('height'))
    const maxHeightBlock = reduce(maxByHeight, blocks[0], blocks)
    return maxHeightBlock;
  }

  longestChain() {
    const getParent = (x) => {
      if (x === undefined) {
        return false
      }

      return [x, this.blocks[x.parentHash]]
    }
    return reverse(unfold(getParent, this.maxHeightBlock()))
  }

  createGenesisBlock() {
    const block = new Block({
      blockchain: this,
      parentHash: 'root',
      height: 1,
      nonce: this.name
    });
    this.blocks[block.hash] = block;
    this.genesis = block;
  }

  containsBlock(block) {
    return this.blocks[block.hash] !== undefined
  }

  addBlock(newBlock) {
    this._addBlock(newBlock)
    publish('BLOCKS_BROADCAST', { blocks: [newBlock.toJSON()], blockchainName: this.name })
  }

  _addBlock(block) {
    if (!block.isValid())
      return
    if (this.containsBlock(block))
      return

    // check that the parent is actually existent and the advertised height is correct
    const parent = this.blocks[block.parentHash];
    if (parent === undefined && parent.height + 1 !== block.height )
      return

    // clone the utxo pool of the parent and reconcile with the block
    const newUtxoPool = parent.utxoPool.clone();
    block.utxoPool = newUtxoPool;

    // Add coinbase coin to the pool
    block.utxoPool.addUTXO(block.coinbaseBeneficiary, 12.5)

    // Reapply transactions to validate them
    const transactions = block.transactions
    block.transactions = {}
    let containsInvalidTransactions = false;

    Object.values(transactions).forEach(transaction => {
      if (block.isValidTransaction(transaction.inputPublicKey, transaction.amount)) {
        block.addTransaction(transaction.inputPublicKey, transaction.outputPublicKey, transaction.amount)
      } else {
        containsInvalidTransactions = true
      }
    })

    // If we found any invalid transactions, dont add the block
    if (containsInvalidTransactions)
      return

    this.blocks[block.hash] = block;
    rerender()
  }
}
export default Blockchain;
