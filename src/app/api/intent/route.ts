import { NextResponse } from 'next/server';
import { IntentService } from '@/lib/services/intent.service';
import { ContractService } from '@/lib/services/contract.service';

export interface Intent {
  userAddress: string;
  tokenFromAddress: string;
  tokenToAddress: string;
  amount: string;
  receive: string;
  expiryTime: number;
  timestamp?: number;
}

const intentService = new IntentService();
const contractService = new ContractService();

export async function POST(request: Request) {
  try {
    const intent: Intent = await request.json();
    
    const result = await intentService.submitIntent(intent);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing intent submission:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to process intent submission' },
      { status: 500 }
    );
  }
} 