#ifndef __RISK_MQH__
#define __RISK_MQH__

enum RiskMode
{
   RISK_GAMBA,
   RISK_MODERATE,
   RISK_SAFE,
   RISK_ZERO,
   RISK_AI
};

RiskMode currentRisk = RISK_MODERATE;
double lotSize = 0.01;

extern double g_riskPercent;
extern double g_fixedLot;

double NormalizeVolume(const double requestedLot)
{
   double step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double minLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);

   if(step <= 0.0)
      step = 0.01;
   if(minLot <= 0.0)
      minLot = step;
   if(maxLot < minLot)
      maxLot = minLot;

   double bounded = MathMax(minLot, MathMin(maxLot, requestedLot));
   double steps   = MathFloor((bounded + (step * 0.5)) / step);
   double lot     = steps * step;
   return MathMax(minLot, MathMin(maxLot, lot));
}

// derive a lot size from balance risk percentage (lightweight approximation)
double CalcLotFromPercent(const double pct)
{
   if(pct <= 0.0)
      return lotSize;

   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double lot = (balance * pct) / 100000.0;
   return NormalizeVolume(lot);
}

void ApplyRiskMode()
{
   switch(currentRisk)
   {
      case RISK_GAMBA:
         lotSize = MathMax(CalcLotFromPercent(g_riskPercent * 2.0), SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN));
         break;
      case RISK_MODERATE:
         lotSize = (g_fixedLot > 0) ? NormalizeVolume(g_fixedLot) : CalcLotFromPercent(g_riskPercent);
         break;
      case RISK_SAFE:
         lotSize = NormalizeVolume(MathMax(g_fixedLot / 2.0, SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN)));
         break;
      case RISK_ZERO:
         lotSize = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
         break;
      case RISK_AI:
         lotSize = CalcLotFromPercent(g_riskPercent);
         break;
      default:
         lotSize = NormalizeVolume(g_fixedLot);
   }
}

#endif // __RISK_MQH__
