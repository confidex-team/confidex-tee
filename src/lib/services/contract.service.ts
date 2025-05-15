import { createPublicClient, http, createWalletClient } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, encodePacked, hashMessage, hexToBigInt, hexToString, hexToNumber} from 'viem';

export interface Deposit {
  userAddress: string;
  token: string;
  amount: bigint;
  timestamp: number;
}

interface Balances {
  [userAddress: string]: {
    [token: string]: bigint;
  };
}

export class ContractService {
  private static instance: ContractService;
  private client;
  private walletClient;
  private deposits: Deposit[] = [];
  private balances: Balances = {};
  private privateKey: string;
  private isInitialized = false;

  private constructor() {
    const rawPrivateKey = process.env.TEE_PRIVATE_KEY;
    if (!rawPrivateKey) {
      throw new Error('TEE_PRIVATE_KEY environment variable is not set');
    }
    
    // Ensure private key is a valid hex string starting with 0x
    this.privateKey = rawPrivateKey.startsWith('0x') ? rawPrivateKey : `0x${rawPrivateKey}`;
    
    this.client = createPublicClient({
      chain: sepolia,
      transport: http(process.env.RPC_URL),
    });
    
    const account = privateKeyToAccount(this.privateKey as `0x${string}`);
    this.walletClient = createWalletClient({
      account,
      chain: sepolia,
      transport: http(process.env.RPC_URL),
    });
  }

  public static getInstance(): ContractService {
    if (!ContractService.instance) {
      ContractService.instance = new ContractService();
    }
    return ContractService.instance;
  }

  private async getEventTimestamp(blockNumber: bigint): Promise<number> {
    const block = await this.client.getBlock({ blockNumber });
    return Number(block.timestamp);
  }

  public async initialize() {
    if (this.isInitialized) return;
    
    console.log('Initializing ContractService');
    await this.startDepositListener();
    this.isInitialized = true;
  }

  private async startDepositListener() {
    const contractAddress = process.env.SOLO_PATTY_CONTRACT;
    console.log(`Starting deposit listener for contract: ${contractAddress}`);
    
    this.client.watchContractEvent({
      address: contractAddress as `0x${string}`,
      abi: [{
        name: 'Deposited',
        type: 'event',
        inputs: [
          { type: 'address', name: 'user', indexed: true },
          { type: 'address', name: 'token', indexed: true },
          { type: 'uint256', name: 'amount' }
        ]
      }],
      eventName: 'Deposited',
      onLogs: async (logs) => {
        for (const log of logs) {
          const timestamp = await this.getEventTimestamp(log.blockNumber);
          const deposit: Deposit = {
            userAddress: `0x${log.topics[1].slice(26)}` as string,
            token: `0x${log.data.slice(26, 66)}` as string,
            amount: BigInt(hexToNumber(`0x${log.data.slice(66)}`)),
            timestamp: Math.floor(new Date(timestamp).getTime() / 1000)
          };
          this.deposits.push(deposit);
          // Update balances
          if (!this.balances[deposit.userAddress]) {
            this.balances[deposit.userAddress] = {};
          }
          if (!this.balances[deposit.userAddress][deposit.token]) {
            this.balances[deposit.userAddress][deposit.token] = BigInt(0);
          }
          this.balances[deposit.userAddress][deposit.token] += deposit.amount;
          
          console.log('New deposit processed', {
            user: deposit.userAddress,
            token: deposit.token,
            amount: deposit.amount.toString(),
            timestamp: timestamp
          });
        }
      },
    });
  }

  getDeposits(): Deposit[] {
    console.debug(`Retrieved ${this.deposits.length} deposits`);
    return this.deposits;
  }

  getBalances(): Balances {
    console.debug('Retrieved all balances');
    return this.balances;
  }

  getUserBalance(userAddress: string, token: string): bigint {
    const balance = this.balances[userAddress]?.[token] || BigInt(0);
    console.debug(`Retrieved balance for user ${userAddress}, token ${token}: ${balance.toString()}`);
    return balance;
  }

  updateBalance(userAddress: string, token: string, newBalance: bigint): void {
    if (!this.balances[userAddress]) {
      this.balances[userAddress] = {};
    }
    const oldBalance = this.balances[userAddress][token] || BigInt(0);
    this.balances[userAddress][token] = newBalance;
    
    console.debug(`Updated balance for user ${userAddress}, token ${token}`, {
      oldBalance: oldBalance.toString(),
      newBalance: newBalance.toString()
    });
  }

  async withdrawTokensWithSignature(userAddress: string, token: string): Promise<{ success: boolean; message: string }> {
    try {
      const amount = this.getUserBalance(userAddress, token);
      if (amount <= BigInt(0)) {
        console.warn(`Withdrawal attempted with insufficient balance`, {
          user: userAddress,
          token,
          balance: amount.toString()
        });
        return { success: false, message: 'Insufficient balance' };
      }
  
      console.log(`Processing withdrawal for user ${userAddress}`, {
        token,
        amount: amount.toString()
      });
  
      // ✅ Step 1: Create message hash
      const messageHash = keccak256(
        encodePacked(
          ['address', 'address', 'uint256'],
          [userAddress as `0x${string}`, token as `0x${string}`, amount]
        )
      );
  
      // ✅ Step 2: Convert to Ethereum Signed Message Hash
      const ethSignedMessageHash = hashMessage(messageHash);
  
      // ✅ Step 3: Sign the message
      const signature = await this.walletClient.signMessage({ message: { raw: ethSignedMessageHash } });
  
      // ✅ Step 4: Prepare contract call
      const contractAddress = process.env.SOLO_PATTY_CONTRACT as `0x${string}`;
  
      const { request } = await this.client.simulateContract({
        address: contractAddress,
        abi: [{
          name: 'withdrawTokensWithSignature',
          type: 'function',
          inputs: [
            { type: 'address', name: 'user' },
            { type: 'address', name: 'token' },
            { type: 'uint256', name: 'amount' },
            { type: 'bytes', name: 'signature' }
          ],
          outputs: [{ type: 'bool' }],
          stateMutability: 'nonpayable'
        }],
        functionName: 'withdrawTokensWithSignature',
        args: [userAddress as `0x${string}`, token as `0x${string}`, amount, signature]
      });
  
      // ✅ Step 5: Send transaction
      const hash = await this.walletClient.writeContract(request);
  
      // ✅ Step 6: Deduct only the withdrawn amount (not reset to 0)
      this.updateBalance(userAddress, token, amount - amount);
  
      console.log(`Withdrawal successful`, {
        user: userAddress,
        token,
        amount: amount.toString(),
        transactionHash: hash
      });
  
      return {
        success: true,
        message: `Withdrawal successful. Transaction hash: ${hash}`
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      console.error(`Withdrawal failed`, {
        error: errorMessage,
        user: userAddress,
        token
      });
      return {
        success: false,
        message: `Withdrawal failed: ${errorMessage}`
      };
    }
  }
} 