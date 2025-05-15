import { Intent } from '@/app/api/intent/route';
import { ContractService } from './contract.service';
import * as crypto from 'crypto';

export enum IntentStatus {
  PENDING,
  MATCHED,
  EXPIRED
}

export interface MatchNotification {
  matchedIntents: {
    intent1: Intent;
    intent2: Intent;
  };
  transactionHash: string;
  timestamp: number;
}

export interface MatchResponse {
  success: boolean;
  message: string;
  match?: MatchNotification;
}

export class IntentService {
  private intents: Intent[] = [];
  private matchInterval: NodeJS.Timeout;
  private matchNotifications: Map<string, MatchNotification[]> = new Map();
  private readonly teeAddress = "0x92b9baA72387Fb845D8Fe88d2a14113F9cb2C4E7";
  private contractService: ContractService;

  constructor() {
    this.contractService = new ContractService();
    this.initializeMatching();
  }

  private initializeMatching() {
    console.log('Initializing IntentService');
    // Start automatic matching every 45 seconds
    this.matchInterval = setInterval(async () => {
      console.debug('Running automatic intent matching');
      // Clean up expired intents first
      this.cleanupExpiredIntents();
      // Then try to match remaining intents
      await this.matchIntents();
    }, 50000);
  }

  private deriveKey(address: string): Buffer {
    return crypto.createHash('sha256').update(address).digest();
  }

  private encryptLogData(logData: any, teeAddress: string) {
    const key = this.deriveKey(teeAddress);
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(JSON.stringify(logData), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag().toString('base64');

    return {
      iv: iv.toString('base64'),
      encryptedData: encrypted,
      authTag: authTag
    };
  }

  private async verifyBalances(intent1: Intent, intent2: Intent): Promise<boolean> {
    const balance1 = this.contractService.getUserBalance(
      intent1.userAddress,
      intent1.tokenFromAddress
    );
    const balance2 = this.contractService.getUserBalance(
      intent2.userAddress,
      intent2.tokenFromAddress
    );
    const hasSufficientBalances = balance1 >= BigInt(intent1.amount) && 
          balance2 >= BigInt(intent2.amount);
    
    console.debug(`Balance verification for intents: ${hasSufficientBalances}`, {
      intent1: { user: intent1.userAddress, balance: balance1.toString() },
      intent2: { user: intent2.userAddress, balance: balance2.toString() }
    });
    
    return hasSufficientBalances;
  }

  private cleanupExpiredIntents() {
    const now = Date.now();
    const beforeCount = this.intents.length;
    this.intents = this.intents.filter(intent => intent.expiryTime > now);
    const afterCount = this.intents.length;
    
    if (beforeCount !== afterCount) {
      console.log(`Cleaned up ${beforeCount - afterCount} expired intents`);
    }
  }

  async submitIntent(intent: Intent): Promise<MatchResponse> {
    const intentWithTimestamp = {
      ...intent,
      timestamp: Date.now(),
    };

    this.intents.push(intentWithTimestamp);

    const logData = {
      user: intent.userAddress,
      fromToken: intent.tokenFromAddress,
      toToken: intent.tokenToAddress,
      amount: intent.amount,
      receive: intent.receive,
      expiryTime: new Date(intent.expiryTime).toISOString()
    };

    const encryptedLog = this.encryptLogData(logData, this.teeAddress);
    
    console.log('New intent submitted', {
      encryptedData: encryptedLog.encryptedData
    });
    
    return {
      success: true,
      message: 'Intent submitted successfully'
    };
  }

  private async matchIntents(): Promise<MatchResponse | null> {
    const activeIntents = this.getActiveIntents();
    console.debug(`Found ${activeIntents.length} active intents to match`);
    
    const matches: { intent1: Intent; intent2: Intent }[] = [];

    // Find matches
    for (let i = 0; i < activeIntents.length; i++) {
      for (let j = i + 1; j < activeIntents.length; j++) {
        const intent1 = activeIntents[i];
        const intent2 = activeIntents[j];

        // Check if intents match (CoW)
        if (
          intent1.tokenFromAddress === intent2.tokenToAddress &&
          intent1.tokenToAddress === intent2.tokenFromAddress &&
          BigInt(intent1.amount) === BigInt(intent2.receive) &&
          BigInt(intent2.amount) === BigInt(intent1.receive)
        ) {
          matches.push({ intent1, intent2 });
          console.debug('Found matching intents', {
            intent1: { user: intent1.userAddress, amount: intent1.amount },
            intent2: { user: intent2.userAddress, amount: intent2.amount }
          });
        }
      }
    }

    // Process matches and update balances
    for (const match of matches) {
      const { intent1, intent2 } = match;
      
      // Verify sufficient balances
      if (await this.verifyBalances(intent1, intent2)) {
        try {
          // Withdraw tokens for both users
          const withdraw1Result = await this.contractService.withdrawTokensWithSignature(
            intent1.userAddress,
            intent1.tokenFromAddress
          );

          const withdraw2Result = await this.contractService.withdrawTokensWithSignature(
            intent2.userAddress,
            intent2.tokenFromAddress
          );

          if (!withdraw1Result.success || !withdraw2Result.success) {
            console.error('Failed to withdraw tokens for matched intents', {
              withdraw1: withdraw1Result,
              withdraw2: withdraw2Result
            });
            return {
              success: false,
              message: 'Failed to withdraw tokens for matched intents'
            };
          }

          // Update balances
          this.contractService.updateBalance(
            intent1.userAddress,
            intent1.tokenFromAddress,
            this.contractService.getUserBalance(
              intent1.userAddress,
              intent1.tokenFromAddress
            ) - BigInt(intent1.amount)
          );
          this.contractService.updateBalance(
            intent1.userAddress,
            intent1.tokenToAddress,
            this.contractService.getUserBalance(
              intent1.userAddress,
              intent1.tokenToAddress
            ) + BigInt(intent1.receive)
          );
          this.contractService.updateBalance(
            intent2.userAddress,
            intent2.tokenFromAddress,
            this.contractService.getUserBalance(
              intent2.userAddress,
              intent2.tokenFromAddress
            ) - BigInt(intent2.amount)
          );
          this.contractService.updateBalance(
            intent2.userAddress,
            intent2.tokenToAddress,
            this.contractService.getUserBalance(
              intent2.userAddress,
              intent2.tokenToAddress
            ) + BigInt(intent2.receive)
          );

          // Remove matched intents
          this.intents = this.intents.filter(
            intent => intent !== intent1 && intent !== intent2
          );

          // Create match notification
          const matchNotification: MatchNotification = {
            matchedIntents: { intent1, intent2 },
            transactionHash: withdraw1Result.message.split(': ')[1], // Extract hash from message
            timestamp: Date.now()
          };

          // Store notifications for both users
          this.storeMatchNotification(intent1.userAddress, matchNotification);
          this.storeMatchNotification(intent2.userAddress, matchNotification);

          console.log('Successfully processed match and withdrawals', {
            intent1: { user: intent1.userAddress, amount: intent1.amount },
            intent2: { user: intent2.userAddress, amount: intent2.amount },
            withdraw1: withdraw1Result.message,
            withdraw2: withdraw2Result.message
          });

          return {
            success: true,
            message: 'Match processed successfully',
            match: matchNotification
          };
        } catch (error) {
          console.error('Error processing match', error);
          return {
            success: false,
            message: `Error processing match: ${error.message}`
          };
        }
      }
    }

    return null;
  }

  private storeMatchNotification(userAddress: string, notification: MatchNotification) {
    if (!this.matchNotifications.has(userAddress)) {
      this.matchNotifications.set(userAddress, []);
    }
    this.matchNotifications.get(userAddress)!.push(notification);
  }

  getMatchNotifications(userAddress: string): MatchNotification[] {
    return this.matchNotifications.get(userAddress) || [];
  }

  getIntents(): Intent[] {
    return this.intents;
  }

  private getActiveIntents(): Intent[] {
    const now = Date.now();
    return this.intents.filter(intent => intent.expiryTime > now);
  }

  getIntentsByUser(userAddress: string): Intent[] {
    return this.intents.filter(intent => intent.userAddress === userAddress);
  }
}