#ifndef NEURAL_NET_MQH
#define NEURAL_NET_MQH

#include "NNFeatures.mqh"

string NN_Trim(const string s)
{
   string x = s;
   StringTrimLeft(x);
   StringTrimRight(x);
   return x;
}

string NN_BuildPayload(const double &feat[])
{
   string tf = EnumToString((ENUM_TIMEFRAMES)Period());
   string json = "{";
   json += "\"symbol\":\"" + _Symbol + "\",";
   json += "\"tf\":\"" + tf + "\",";

   json += "\"features\":{";
   int n = ArraySize(feat);
   for(int i = 0; i < n; i++)
   {
      json += "\"f" + IntegerToString(i) + "\":" + DoubleToString(feat[i], 8);
      if(i < n - 1) json += ",";
   }
   json += "},";

   json += "\"feature_vector\":[";
   for(int j = 0; j < n; j++)
   {
      json += DoubleToString(feat[j], 8);
      if(j < n - 1) json += ",";
   }
   json += "]}";

   return json;
}

bool NN_ExtractNumber(const string &json, const string &key, double &out)
{
   int k = StringFind(json, "\"" + key + "\"");
   if(k < 0) return false;

   int colon = StringFind(json, ":", k);
   if(colon < 0) return false;

   int endComma = StringFind(json, ",", colon);
   int endBrace = StringFind(json, "}", colon);
   int end = endComma;
   if(end < 0 || (endBrace >= 0 && endBrace < end)) end = endBrace;
   if(end < 0) return false;

   string val = StringSubstr(json, colon + 1, end - (colon + 1));
   val = NN_Trim(val);
   out = StringToDouble(val);
   return true;
}

bool NN_ExtractInt(const string &json, const string &key, int &out)
{
   double tmp = 0.0;
   if(!NN_ExtractNumber(json, key, tmp)) return false;
   out = (int)MathRound(tmp);
   return true;
}

bool NN_ExtractString(const string &json, const string &key, string &out)
{
   int k = StringFind(json, "\"" + key + "\"");
   if(k < 0) return false;

   int colon = StringFind(json, ":", k);
   if(colon < 0) return false;

   int q1 = StringFind(json, "\"", colon + 1);
   if(q1 < 0) return false;

   int q2 = StringFind(json, "\"", q1 + 1);
   if(q2 < 0) return false;

   out = StringSubstr(json, q1 + 1, q2 - q1 - 1);
   return true;
}

bool NN_WebPredict(const string url, const string jsonPayload, string &response)
{
   char post[], result[];
   string headers = "Content-Type: application/json\r\n";
   int timeout = NN_TimeoutMs;

   StringToCharArray(jsonPayload, post);

   ResetLastError();
   string result_headers;
   int res = WebRequest("POST", url, headers, timeout, post, result, result_headers);

   if(res == -1)
   {
      if(NN_DebugPrint)
         Print("NN WebRequest failed. Error=", GetLastError(), " | URL=", url);
      return false;
   }

   response = CharArrayToString(result);
   return true;
}

bool InitializeNeuralNet()
{
   if(!Use_NeuralNet) return false;

   NN_Initialized = true;
   NN_LastRun     = 0;
   NN_Bias        = 0;
   NN_Confidence  = 0.0;
   NN_RiskScore   = 50.0;
   NN_Explain     = "NN init ok";
   return true;
}

bool UpdateNeuralNetSignal()
{
   NN_UsedLastTick = false;

   if(!Use_NeuralNet || !NN_Initialized)
      return false;

   datetime now = TimeCurrent();
   if(NN_LastRun > 0 && (now - NN_LastRun) < NN_CooldownSeconds)
      return false;

   // g_nn_url is set by AutoDetectDeployment() in OnInit
   if(StringLen(g_nn_url) < 10)
   {
      NN_Explain = "NN URL not resolved";
      return false;
   }

   double feat[];
   int n = BuildNNFeatures(feat);
   if(n <= 0)
      return false;

   string payload = NN_BuildPayload(feat);
   string resp;

   if(!NN_WebPredict(g_nn_url, payload, resp))
   {
      NN_Explain = "NN request failed";
      return false;
   }

   int bias = 0;
   double conf = 0.0, risk = 50.0;
   string explain = "";

   bool ok1 = NN_ExtractInt(resp, "bias", bias);
   bool ok2 = NN_ExtractNumber(resp, "confidence", conf);
   bool ok3 = NN_ExtractNumber(resp, "risk", risk);
   NN_ExtractString(resp, "explain", explain);

   if(!(ok1 && ok2 && ok3))
   {
      NN_Explain = "NN parse failed: " + resp;
      return false;
   }

   if(bias > 1)  bias = 1;
   if(bias < -1) bias = -1;

   NN_Bias       = bias;
   NN_Confidence = NN_Clamp(conf, 0.0, 100.0);
   NN_RiskScore  = NN_Clamp(risk, 0.0, 100.0);
   NN_Explain    = (explain == "" ? "ok" : explain);
   NN_LastRun    = now;
   NN_UsedLastTick = true;

   if(NN_DebugPrint)
      Print("NN => bias=", NN_Bias,
            " conf=", DoubleToString(NN_Confidence, 1),
            " risk=", DoubleToString(NN_RiskScore, 1),
            " | ", NN_Explain);

   return true;
}

bool NN_IsUsable()
{
   if(!Use_NeuralNet || !NN_Initialized)   return false;
   if(NN_Confidence < NN_MinConfidenceToUse) return false;
   if(NN_RiskScore  > NN_MaxRiskToUse)       return false;
   return true;
}

#endif
