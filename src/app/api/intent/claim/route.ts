import { NextResponse } from 'next/server';
import { ContractService } from '@/lib/services/contract.service';

const contractService = new ContractService();

export async function POST(request: Request) {
  try {
    const { userAddress, token } = await request.json();
    
    const result = await contractService.withdrawTokensWithSignature(
      userAddress,
      token
    );
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing token claim:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to process token claim' },
      { status: 500 }
    );
  }
} 