#ifndef __SETTINGS_MQH__
#define __SETTINGS_MQH__

#include "Risk.mqh"

// Global settings placeholders

input int   Input_MaxPositions = 3;    // Max simultaneous positions
input double Input_BaseLot = 0.01;     // Base lot size before risk scaling
input bool  Input_AutoTrade = true;    // Enable automated trade execution
input string Input_GeminiApiKey = "";  // Gemini API key (leave empty to disable)

void ApplySettings()
{
   lotSize = Input_BaseLot;
}

#endif // __SETTINGS_MQH__
