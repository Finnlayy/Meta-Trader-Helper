#ifndef __DYNAMICLOT_MQH__
#define __DYNAMICLOT_MQH__

// Dynamic lot sizing helpers

double CalculateDynamicLot(double riskPercent)
{
   // placeholder calculation: riskPercent of account balance / fixed pip value
   double bal = AccountBalance();
   double lot = bal * riskPercent / 100000.0; // simplistic
   if(lot < 0.01) lot = 0.01;
   return NormalizeDouble(lot, 2);
}

void TestDynamicLotGeneration()
{
   for(int i=0;i<10;i++)
   {
      double l = CalculateDynamicLot(0.1 + i*0.1);
      PrintFormat("Dynamic lot for %f: %f", 0.1 + i*0.1, l);
   }
}

#endif // __DYNAMICLOT_MQH__
