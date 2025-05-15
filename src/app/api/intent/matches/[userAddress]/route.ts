import { NextResponse } from 'next/server';
import { IntentService } from '@/lib/services/intent.service';

const intentService = new IntentService();

export async function GET(
  request: Request,
  { params }: { params: { userAddress: string } }
) {
  try {
    const { userAddress } = params;
    
    const notifications = intentService.getMatchNotifications(userAddress);
    
    return NextResponse.json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error('Error retrieving match notifications:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to retrieve match notifications' },
      { status: 500 }
    );
  }
} 