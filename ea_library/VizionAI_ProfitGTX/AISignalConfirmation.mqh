#ifndef AI_SIGNAL_CONFIRMATION_MQH
#define AI_SIGNAL_CONFIRMATION_MQH

// ---------------------------------------------------------------------------
// AISignalConfirmation.mqh — Trade gate using AI Gateway
// advisory: allow at 0.5x size if gateway is down
// mandatory: block trade if gateway is down or returns NO
// off: always allow (no AI gate)
// ---------------------------------------------------------------------------

bool AIApproveTrade(const bool is_buy, const string setup_name, double &size_multiplier)
{
   if(!AI_Validate_Trades || AI_Mode == "off")
      return true;

   return AIValidateTrade(setup_name, is_buy, size_multiplier);
}

#endif
