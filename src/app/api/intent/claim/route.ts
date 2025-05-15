import { NextResponse } from 'next/server';
import { ContractService } from '@/lib/services/contract.service';

const contractService = ContractService.getInstance();

export async function POST(request: Request) {
  try {
    const { userAddress, token } = await request.json();
    
    console.debug('Received token claim request', {
      user: userAddress,
      token: token
    });
    
    const result = await contractService.withdrawTokensWithSignature(
      userAddress,
      token
    );
    
    console.debug('Token claim processed', {
      success: result.success,
      message: result.message
    });
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error processing token claim:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to process token claim' },
      { status: 500 }
    );
  }
} 