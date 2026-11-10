//+------------------------------------------------------------------+
//|                                                    fast_json.mqh |
//|                    AI Toolkit - Neural Execution Unified System  |
//|                                                                  |
//| Module: Json (The "Bit-Banger" Edition V2)                       |
//| Description: PRODUCTION GRADE HIGH PERFORMANCE JSON LIBRARY      |
//|              - Iterative State Machine (No Recursion)            |
//|              - SWAR Scanner (Simulated 64-bit)                   |
//|              - Tape-based Zero-Alloc Memory Model                |
//|              - CJsonNode Handle-based Navigation                 |
//|              - High Throughput Serialization                     |
//|                                                                  |
//| Author: Jonathan Pereira                                         |
//| Created: 2022                                                    |
//| Version: 3.4.2                                                   |
//| License: MIT                                                     |
//|                                                                  |
//| Integrated into The Architect for: ChatGPT API, Telegram,        |
//| news feed REST API response parsing (V1.3 features)             |
//+------------------------------------------------------------------+


#ifndef FASTJSON_FASTJSON_MQH
#define FASTJSON_FASTJSON_MQH


#property copyright "AIToolkit Framework"
#property version "3.50"
#property strict

//+------------------------------------------------------------------+
//| Constants & Masks                                                |
//+------------------------------------------------------------------+
#define J_NULL 0x00
#define J_BOOL 0x01
#define J_INT 0x02
#define J_DBL 0x03
#define J_STR 0x04
#define J_ARR 0x05
#define J_OBJ 0x06
#define J_KEY 0x07 // Internal use

// SWAR Constants
#define SWAR_LO 0x0101010101010101
#define SWAR_HI 0x8080808080808080
#define SWAR_QUOTE 0x2222222222222222
#define SWAR_SLASH 0x5C5C5C5C5C5C5C5C

// Char Class
#define CC_WHITE 1
#define CC_STRUCT 2
#define CC_QUOTE 3
#define CC_DIGIT 4
#define CC_OTHER 0

// Parser States
#define ST_VAL 0
#define ST_ARR 1
#define ST_OBJ 2
#define ST_KEY 3

// Error Codes
enum EnumJsonError {
  JSON_OK = 0,
  JSON_ERR_INVALID_CHAR,
  JSON_ERR_UNEXPECTED_END,
  JSON_ERR_STACK_OVERFLOW,
  JSON_ERR_INVALID_NUMBER,
  JSON_ERR_EXPECTED_KEY,
  JSON_ERR_EXPECTED_COLON,
  JSON_ERR_WRONG_TYPE
};

//+------------------------------------------------------------------+
//| Globals (Lookup Tables)                                          |
//+------------------------------------------------------------------+
uchar g_cc[256];
bool g_init = false;

// v3.4.0: Exp10/Pow10 lookup tables (compile-time constants, L1-friendly)
double g_Exp10[19]; // 1e0, 1e-1, ..., 1e-18
double g_Pow10[19]; // 1e0, 1e1, ..., 1e18

void InitTables() {
  if (g_init)
    return;
  ArrayInitialize(g_cc, CC_OTHER);
  g_cc[' '] = CC_WHITE;
  g_cc['\t'] = CC_WHITE;
  g_cc['\r'] = CC_WHITE;
  g_cc['\n'] = CC_WHITE;
  g_cc['{'] = CC_STRUCT;
  g_cc['}'] = CC_STRUCT;
  g_cc['['] = CC_STRUCT;
  g_cc[']'] = CC_STRUCT;
  g_cc[':'] = CC_STRUCT;
  g_cc[','] = CC_STRUCT;
  g_cc['"'] = CC_QUOTE;
  g_cc['0'] = CC_DIGIT;
  g_cc['1'] = CC_DIGIT;
  g_cc['2'] = CC_DIGIT;
  g_cc['3'] = CC_DIGIT;
  g_cc['4'] = CC_DIGIT;
  g_cc['5'] = CC_DIGIT;
  g_cc['6'] = CC_DIGIT;
  g_cc['7'] = CC_DIGIT;
  g_cc['8'] = CC_DIGIT;
  g_cc['9'] = CC_DIGIT;
  g_cc['-'] = CC_DIGIT;

  // v3.4.0: Initialize Exp10/Pow10 tables
  for (int i = 0; i < 19; i++) {
    g_Exp10[i] = MathPow(10.0, -(double)i);
    g_Pow10[i] = MathPow(10.0, (double)i);
  }

  g_init = true;
}

//+------------------------------------------------------------------+
//| CJsonContext: The Engine                                         |
//+------------------------------------------------------------------+
class CJsonContext {
public:
  //-- Memory Arenas
  long tape[]; // The AST
  int tape_pos;

  uchar buffer[]; // Raw Input Data
  int len;

  int last_error;
  string error_msg;
  int err_pos; // Position where error occurred

  //-- Stack
  int stack_node[512];
  int stack_state[512];
  int stack_count[512];
  int sp;

  //-- Accessors
  int GetType(int idx) { return (int)((tape[idx] >> 56) & 0xFF); }
  long GetSize(int idx) { return tape[idx] & 0xFFFFFFFF; }
  int GetCount(int idx) { return (int)((tape[idx] >> 32) & 0xFFFFFF); }

  long GetInt(int idx) { return tape[idx + 1]; }
  double GetDouble(int idx) {
    union U {
      double d;
      long l;
    } u;
    u.l = tape[idx + 1];
    return u.d;
  }
  bool GetBool(int idx) { return (tape[idx] & 1) == 1; }

  string GetStr(int idx) {
    if (idx < 0 || idx >= tape_pos)
      return "";
    long data = tape[idx + 1];
    int p = (int)(data >> 32);
    int l = (int)(data & 0xFFFFFFFF);
    return Unescape(p, l);
  }

  //-- Utils
  bool Reserve(int size) {
    int current = ArraySize(tape);
    if (current < size) {
      int geometric = current + (current >> 1); // 1.5x growth
      int new_cap =
          (size > geometric) ? size + 4096 : geometric; // Ensure enough space

      if (ArrayResize(tape, new_cap) == -1) {
        last_error = JSON_ERR_STACK_OVERFLOW;
        Print("FAST_JSON CRITICAL: ArrayResize failed! Cap=", new_cap,
              " Req=", size);
        return false;
      }
    }
    return true;
  }

  ulong Load64(int ptr) {
    if (ptr + 7 >= len)
      return 0;
    return (ulong)buffer[ptr] | ((ulong)buffer[ptr + 1] << 8) |
           ((ulong)buffer[ptr + 2] << 16) | ((ulong)buffer[ptr + 3] << 24) |
           ((ulong)buffer[ptr + 4] << 32) | ((ulong)buffer[ptr + 5] << 40) |
           ((ulong)buffer[ptr + 6] << 48) | ((ulong)buffer[ptr + 7] << 56);
  }

  int SkipWS(int ptr) {
    while (ptr < len && g_cc[buffer[ptr]] == CC_WHITE)
      ptr++;
    return ptr;
  }

  void GetErrorLocation(int ptr, int &err_line, int &err_col) {
    err_line = 1;
    err_col = 1;
    for (int i = 0; i < ptr && i < len; i++) {
      if (buffer[i] == '\n') {
        err_line++;
        err_col = 1;
      } else
        err_col++;
    }
  }

  int ScanString(int ptr) {
    int start = ptr;
    while (ptr + 8 < len) {
      ulong word = Load64(ptr);
      ulong x_q = word ^ SWAR_QUOTE;
      ulong x_s = word ^ SWAR_SLASH;
      ulong z_q = (x_q - SWAR_LO) & ~x_q & SWAR_HI;
      ulong z_s = (x_s - SWAR_LO) & ~x_s & SWAR_HI;
      if (z_q != 0 || z_s != 0)
        break;
      ptr += 8;
    }
    while (ptr < len) {
      uchar c = buffer[ptr];
      if (c == '"')
        return ptr - start;
      if (c == '\\') {
        ptr += 2;
        continue;
      }
      ptr++;
    }
    return ptr - start;
  }

  long FastAtoi(int ptr, int n_len) {
    long val = 0;
    int sign = 1;
    int i = 0;
    if (buffer[ptr] == '-') {
      sign = -1;
      i++;
    }
    for (; i <= n_len - 4; i += 4) {
      val = val * 10000 + buffer[ptr + i] * 1000 + buffer[ptr + i + 1] * 100 +
            buffer[ptr + i + 2] * 10 + buffer[ptr + i + 3] - '0' * 1111;
    }
    for (; i < n_len; i++)
      val = val * 10 + (buffer[ptr + i] - '0');
    return val * sign;
  }

  bool ParseNumber(int &cur) {
    int start = cur;
    long val = 0;
    int sign = 1;

    if (buffer[cur] == '-') {
      sign = -1;
      cur++;
    }

    // Integer Part (Single Pass)
    while (cur < len) {
      uchar c = buffer[cur];
      if ((c ^ '0') <= 9) { // Bitwise IsDigit
        val = val * 10 + (c - '0');
        cur++;
      } else if (c == '.' || c == 'e' || c == 'E') {
        int idx = tape_pos++;

        cur++; // skip . or e
        while (cur < len) {
          uchar cc = buffer[cur];
          if ((cc ^ '0') > 9 && cc != '+' && cc != '-' && cc != 'e' &&
              cc != 'E')
            break;
          cur++;
        }

        int n_len = cur - start;
        tape[idx] = ((long)J_DBL << 56) | 2;
        tape[tape_pos++] = DBL2LONG(FastAtof(start, n_len));
        return true;
      } else {
        break; // End of integer
      }
    }

    int idx = tape_pos++;
    tape[idx] = ((long)J_INT << 56) | 2;
    tape[tape_pos++] = val * sign;
    return true;
  }

  double FastAtof(int ptr, int n_len) {
    double val = 0.0;
    double sign = 1.0;
    int i = 0;
    if (buffer[ptr] == '-') {
      sign = -1.0;
      i++;
    }
    long int_val = 0;
    bool use_long = true;
    for (; i < n_len; i++) {
      uchar c = buffer[ptr + i];
      if (c == '.' || c > '9')
        break;
      if (use_long && int_val < 922337203685477580) {
        int_val = int_val * 10 + (c - '0');
      } else {
        if (use_long) {
          val = (double)int_val;
          use_long = false;
        }
        val = val * 10.0 + (c - '0');
      }
    }
    if (use_long)
      val = (double)int_val;
    if (i < n_len && buffer[ptr + i] == '.') {
      i++;
      long frac_int = 0;
      int frac_digits = 0;
      for (; i < n_len; i++) {
        uchar c = buffer[ptr + i];
        if (c > '9')
          break;
        frac_int = frac_int * 10 + (c - '0');
        frac_digits++;
      }
      if (frac_digits <= 18)
        val += frac_int * g_Exp10[frac_digits];
      else {
        double frac = (double)frac_int;
        for (int k = 0; k < frac_digits; k++)
          frac *= 0.1;
        val += frac;
      }
    }
    if (i < n_len && buffer[ptr + i] > '9') { // e or E
      i++;
      int exp_sign = 1;
      if (i < n_len && buffer[ptr + i] == '-') {
        exp_sign = -1;
        i++;
      } else if (i < n_len && buffer[ptr + i] == '+') {
        i++;
      }
      int exp_val = 0;
      for (; i < n_len; i++)
        exp_val = exp_val * 10 + (buffer[ptr + i] - '0');
      if (exp_val <= 18) {
        if (exp_sign == 1)
          val *= g_Pow10[exp_val];
        else
          val *= g_Exp10[exp_val];
      } else {
        double p = 1.0;
        for (int k = 0; k < exp_val; k++)
          p *= 10.0;
        if (exp_sign == 1)
          val *= p;
        else
          val /= p;
      }
    }
    return val * sign;
  }

  string Unescape(int ptr, int str_len) {
    bool dirty = false;
    for (int i = 0; i < str_len; i++) {
      if (buffer[ptr + i] == '\\') {
        dirty = true;
        break;
      }
    }
    if (!dirty)
      return CharArrayToString(buffer, ptr, str_len, CP_UTF8);

    ushort res[];
    ArrayResize(res, str_len);
    int pos = 0;
    for (int i = 0; i < str_len; i++) {
      uchar c = buffer[ptr + i];
      if (c == '\\' && i + 1 < str_len) {
        i++;
        uchar next = buffer[ptr + i];
        switch (next) {
        case '"':
          res[pos++] = '"';
          break;
        case '\\':
          res[pos++] = '\\';
          break;
        case '/':
          res[pos++] = '/';
          break;
        case 'b':
          res[pos++] = '\x08';
          break;
        case 'f':
          res[pos++] = '\f';
          break;
        case 'n':
          res[pos++] = '\n';
          break;
        case 'r':
          res[pos++] = '\r';
          break;
        case 't':
          res[pos++] = '\t';
          break;
        case 'u': {
          if (i + 4 < str_len) {
            int code = (HexToDec(buffer[ptr + i + 1]) << 12) |
                       (HexToDec(buffer[ptr + i + 2]) << 8) |
                       (HexToDec(buffer[ptr + i + 3]) << 4) |
                       HexToDec(buffer[ptr + i + 4]);
            res[pos++] = (ushort)code;
            i += 4;
          } else
            res[pos++] = 'u';
          break;
        }
        default:
          res[pos++] = next;
          break;
        }
      } else
        res[pos++] = c;
    }
    return ShortArrayToString(res, 0, pos);
  }

  long DBL2LONG(double d) {
    union U {
      double d;
      long l;
    } u;
    u.d = d;
    return u.l;
  }

  int HexToDec(uchar c) {
    if (c >= '0' && c <= '9')
      return c - '0';
    if (c >= 'a' && c <= 'f')
      return c - 'a' + 10;
    if (c >= 'A' && c <= 'F')
      return c - 'A' + 10;
    return 0;
  }

public:
  bool Parse(string json_str) {
    if (!g_init)
      InitTables();
    tape_pos = 0;
    sp = 0;
    last_error = JSON_OK;

    int str_len = StringLen(json_str);
    if (ArraySize(buffer) < str_len + 8)
      ArrayResize(buffer, str_len + 1024);
    int wr = StringToCharArray(json_str, buffer, 0, WHOLE_ARRAY, CP_UTF8);
    len = (wr > 0 && buffer[wr - 1] == 0) ? wr - 1 : wr;

    if (!Reserve(len * 2 + 1024))
      return false;

    int cur = 0;
    stack_state[sp] = ST_VAL;
    stack_node[sp] = -1;
    stack_count[sp] = 0;
    sp++;
    int key_ptr = 0;
    int key_len = 0;
    uint key_hash = 0;

    while (sp > 0) {
      if (!Reserve(tape_pos + 32)) {
        return false;
      }

      cur = SkipWS(cur);
      if (cur >= len)
        break;

      uchar c = buffer[cur];
      int state = stack_state[sp - 1];

      if (state == ST_VAL) {
        if (sp > 1)
          stack_count[sp - 2]++;

        if (key_len > 0) {
          tape[tape_pos++] = ((long)J_KEY << 56);
          tape[tape_pos++] = ((long)key_ptr << 32) | (long)key_hash;
          key_len = 0;
        }

        if (c == '"') {
          cur++;
          int start = cur;
          int l = ScanString(cur);
          cur += l + 1;
          tape[tape_pos++] = ((long)J_STR << 56) | 2;
          tape[tape_pos++] = ((long)start << 32) | (long)l;
          sp--;
        } else if ((c ^ '0') <= 9 || c == '-') {
          if (!ParseNumber(cur))
            return false;
          sp--;
        } else if (c == '{') {
          if (sp >= 512) {
            last_error = JSON_ERR_STACK_OVERFLOW;
            err_pos = cur;
            return false;
          }
          int idx = tape_pos++;
          stack_state[sp - 1] = ST_OBJ;
          stack_node[sp - 1] = idx;
          stack_count[sp - 1] = 0;
          cur++;
        } else if (c == '[') {
          if (sp >= 512) {
            last_error = JSON_ERR_STACK_OVERFLOW;
            err_pos = cur;
            return false;
          }
          int idx = tape_pos++;
          stack_state[sp - 1] = ST_ARR;
          stack_node[sp - 1] = idx;
          stack_count[sp - 1] = 0;
          cur++;
        } else if (c == 't') {
          cur += 4;
          tape[tape_pos++] = ((long)J_BOOL << 56) | 1;
          sp--;
        } else if (c == 'f') {
          cur += 5;
          tape[tape_pos++] = ((long)J_BOOL << 56) | 1;
          sp--;
        } else if (c == 'n') {
          cur += 4;
          tape[tape_pos++] = ((long)J_NULL << 56) | 1;
          sp--;
        } else {
          last_error = JSON_ERR_INVALID_CHAR;
          err_pos = cur;
          return false;
        }
      } else if (state == ST_OBJ) {
        if (c == '}') {
          int idx = stack_node[sp - 1];
          long size = tape_pos - idx;
          int count = stack_count[sp - 1];
          tape[idx] = ((long)J_OBJ << 56) | ((long)(count & 0xFFFFFF) << 32) |
                      (size & 0xFFFFFFFF);
          cur++;
          sp--;
        } else {
          if (c == ',') {
            cur++;
            continue;
          }
          if (c != '"') {
            last_error = JSON_ERR_EXPECTED_KEY;
            err_pos = cur;
            return false;
          }
          cur++;
          key_ptr = cur;
          key_len = ScanString(cur);
          cur += key_len + 1;

          key_hash = 2166136261;
          for (int i = 0; i < key_len; i++)
            key_hash = (key_hash ^ buffer[key_ptr + i]) * 16777619;

          cur = SkipWS(cur);
          if (buffer[cur] != ':') {
            last_error = JSON_ERR_EXPECTED_COLON;
            err_pos = cur;
            return false;
          }
          cur++;
          stack_state[sp] = ST_VAL;
          stack_node[sp] = -1;
          sp++;
        }
      } else if (state == ST_ARR) {
        if (c == ']') {
          int idx = stack_node[sp - 1];
          long size = tape_pos - idx;
          int count = stack_count[sp - 1];
          tape[idx] = ((long)J_ARR << 56) | ((long)(count & 0xFFFFFF) << 32) |
                      (size & 0xFFFFFFFF);
          cur++;
          sp--;
        } else {
          if (c == ',') {
            cur++;
            continue;
          }
          stack_state[sp] = ST_VAL;
          stack_node[sp] = -1;
          sp++;
        }
      }
    }
    return (last_error == JSON_OK);
  }

  string Serialize(bool pretty) {
    if (tape_pos == 0)
      return "";

    uchar out[];
    int cap = len * 2;
    if (cap < 1024)
      cap = 1024;
    ArrayResize(out, cap);
    int pos = 0;

    if (pretty)
      WriteNodePretty(0, out, pos, cap, 0);
    else
      WriteNode(0, out, pos, cap);

    return CharArrayToString(out, 0, pos);
  }

  void WriteNode(int idx, uchar &out[], int &pos, int &cap) {
    if (idx >= tape_pos)
      return;
    int type = GetType(idx);

    switch (type) {
    case J_NULL:
      PutRaw("null", out, pos, cap);
      break;
    case J_BOOL:
      PutRaw(GetBool(idx) ? "true" : "false", out, pos, cap);
      break;
    case J_INT:
      PutRawInteger(GetInt(idx), out, pos, cap);
      break;
    case J_DBL:
      PutRawDouble(GetDouble(idx), out, pos, cap);
      break;
    case J_STR: {
      long data = tape[idx + 1];
      int p = (int)(data >> 32);
      int l = (int)(data & 0xFFFFFFFF);
      PutChar('"', out, pos, cap);
      CheckCap(l, pos, cap, out);
      ArrayCopy(out, buffer, pos, p, l);
      pos += l;
      PutChar('"', out, pos, cap);
      break;
    }
    case J_ARR: {
      PutChar('[', out, pos, cap);
      int count = GetCount(idx);
      int cur = idx + 1;
      for (int i = 0; i < count; i++) {
        if (i > 0)
          PutChar(',', out, pos, cap);
        WriteNode(cur, out, pos, cap);
        cur += GetStep(cur);
      }
      PutChar(']', out, pos, cap);
      break;
    }
    case J_OBJ: {
      PutChar('{', out, pos, cap);
      int count = GetCount(idx);
      int cur = idx + 1;
      int emitted = 0;
      while (emitted < count) {
        int t = GetType(cur);
        if (t == J_KEY) {
          if (emitted > 0)
            PutChar(',', out, pos, cap);
          PutChar('"', out, pos, cap);

          long kp = tape[cur + 1];
          int kptr = (int)(kp >> 32);
          int klen = 0;
          while (buffer[kptr + klen] != '"')
            klen++;

          CheckCap(klen, pos, cap, out);
          ArrayCopy(out, buffer, pos, kptr, klen);
          pos += klen;

          PutChar('"', out, pos, cap);
          PutChar(':', out, pos, cap);

          int val_idx = cur + 2;
          WriteNode(val_idx, out, pos, cap);

          cur = val_idx + GetStep(val_idx);
          emitted++;
        } else {
          cur++;
        }
      }
      PutChar('}', out, pos, cap);
      break;
    }
    }
  }

  void WriteNodePretty(int idx, uchar &out[], int &pos, int &cap, int depth) {
    if (idx >= tape_pos)
      return;
    int type = GetType(idx);

    switch (type) {
    case J_NULL:
      PutRaw("null", out, pos, cap);
      break;
    case J_BOOL:
      PutRaw(GetBool(idx) ? "true" : "false", out, pos, cap);
      break;
    case J_INT:
      PutRawInteger(GetInt(idx), out, pos, cap);
      break;
    case J_DBL:
      PutRawDouble(GetDouble(idx), out, pos, cap);
      break;
    case J_STR: {
      long data = tape[idx + 1];
      int p = (int)(data >> 32);
      int l = (int)(data & 0xFFFFFFFF);
      PutChar('"', out, pos, cap);
      CheckCap(l, pos, cap, out);
      ArrayCopy(out, buffer, pos, p, l);
      pos += l;
      PutChar('"', out, pos, cap);
      break;
    }
    case J_ARR: {
      int count = GetCount(idx);
      if (count == 0) {
        PutRaw("[]", out, pos, cap);
        return;
      }

      PutChar('[', out, pos, cap);
      PutChar('\n', out, pos, cap);

      int cur = idx + 1;
      for (int i = 0; i < count; i++) {
        if (i > 0) {
          PutChar(',', out, pos, cap);
          PutChar('\n', out, pos, cap);
        }
        Indent(depth + 1, out, pos, cap);
        WriteNodePretty(cur, out, pos, cap, depth + 1);
        cur += GetStep(cur);
      }
      PutChar('\n', out, pos, cap);
      Indent(depth, out, pos, cap);
      PutChar(']', out, pos, cap);
      break;
    }
    case J_OBJ: {
      int count = GetCount(idx);
      if (count == 0) {
        PutRaw("{}", out, pos, cap);
        return;
      }

      PutChar('{', out, pos, cap);
      PutChar('\n', out, pos, cap);

      int cur = idx + 1;
      int emitted = 0;
      while (emitted < count) {
        int t = GetType(cur);
        if (t == J_KEY) {
          if (emitted > 0) {
            PutChar(',', out, pos, cap);
            PutChar('\n', out, pos, cap);
          }
          Indent(depth + 1, out, pos, cap);

          PutChar('"', out, pos, cap);
          long kp = tape[cur + 1];
          int kptr = (int)(kp >> 32);
          int klen = 0;
          while (buffer[kptr + klen] != '"')
            klen++;
          CheckCap(klen, pos, cap, out);
          ArrayCopy(out, buffer, pos, kptr, klen);
          pos += klen;
          PutChar('"', out, pos, cap);

          PutRaw(": ", out, pos, cap);

          int val_idx = cur + 2;
          WriteNodePretty(val_idx, out, pos, cap, depth + 1);

          cur = val_idx + GetStep(val_idx);
          emitted++;
        } else {
          cur++;
        }
      }
      PutChar('\n', out, pos, cap);
      Indent(depth, out, pos, cap);
      PutChar('}', out, pos, cap);
      break;
    }
    }
  }

  void Indent(int depth, uchar &out[], int &pos, int &cap) {
    CheckCap(depth * 3, pos, cap, out);
    for (int i = 0; i < depth; i++) {
      out[pos++] = ' ';
      out[pos++] = ' ';
      out[pos++] = ' ';
    }
  }

  void PutChar(uchar c, uchar &out[], int &pos, int &cap) {
    if (pos >= cap) {
      cap = (int)(cap * 1.5) + 32;
      ArrayResize(out, cap);
    }
    out[pos++] = c;
  }

  void PutRaw(string s, uchar &out[], int &pos, int &cap) {
    int l = StringLen(s);
    CheckCap(l, pos, cap, out);
    StringToCharArray(s, out, pos, l);
    pos += l;
  }

  void PutRawInteger(long value, uchar &out[], int &pos, int &cap) {
    if (value == 0) {
      PutChar('0', out, pos, cap);
      return;
    }
    if (value < 0) {
      PutChar('-', out, pos, cap);
      value = -value;
    }
    uchar digits[20];
    int n = 0;
    while (value > 0) {
      digits[n++] = (uchar)('0' + (int)(value % 10));
      value /= 10;
    }
    CheckCap(n, pos, cap, out);
    for (int j = n - 1; j >= 0; j--)
      out[pos++] = digits[j];
  }

  void PutRawDouble(double value, uchar &out[], int &pos, int &cap) {
    if (!MathIsValidNumber(value)) {
      PutRaw("null", out, pos, cap);
      return;
    }
    if (value == 0.0) {
      PutRaw("0.0", out, pos, cap);
      return;
    }
    if (value < 0.0) {
      PutChar('-', out, pos, cap);
      value = -value;
    }
    long int_part = (long)value;
    PutRawInteger(int_part, out, pos, cap);
    PutChar('.', out, pos, cap);
    double frac = value - (double)int_part;
    uchar frac_digits[8];
    int n = 0;
    for (int k = 0; k < 8; k++) {
      frac *= 10.0;
      int d = (int)frac;
      frac -= d;
      frac_digits[n++] = (uchar)('0' + d);
    }
    while (n > 1 && frac_digits[n - 1] == '0')
      n--;
    CheckCap(n, pos, cap, out);
    for (int k = 0; k < n; k++)
      out[pos++] = frac_digits[k];
  }

  void CheckCap(int req, int pos, int &cap, uchar &out[]) {
    if (pos + req >= cap) {
      cap = cap + req + 4096;
      ArrayResize(out, cap);
    }
  }

  int GetStep(int idx) { return (int)(tape[idx] & 0xFFFFFFFF); }
};

//+------------------------------------------------------------------+
//| CJsonIterator: Fast Traversal                                    |
//+------------------------------------------------------------------+
struct CJsonNode; // Forward Declaration

struct CJsonIterator {
  CJsonContext *ctx;
  int cur_idx;
  int end_idx;
  int steps_taken;
  int total_count;

  bool IsValid() { return (cur_idx < end_idx && steps_taken < total_count); }

  void Next() {
    if (!IsValid())
      return;

    int type = ctx.GetType(cur_idx);
    if (type == J_KEY) {
      int val_idx = cur_idx + 2;
      cur_idx += 2 + ctx.GetStep(val_idx);
    } else {
      cur_idx += ctx.GetStep(cur_idx);
    }
    steps_taken++;
  }

  CJsonNode Val();
  string Key();

  double ValueDouble() {
    if (!IsValid())
      return double("nan");
    int target = cur_idx;
    if (((ctx.tape[cur_idx] >> 56) & 0xFF) == J_KEY)
      target = cur_idx + 2;

    union U {
      double d;
      long l;
    } u;
    u.l = ctx.tape[target + 1];
    return u.d;
  }
};

//+------------------------------------------------------------------+
//| CJsonFastDoubleIterator (For double[] only)                      |
//+------------------------------------------------------------------+
struct CJsonFastDoubleIterator {
  CJsonContext *ctx;
  int cur_idx;
  int end_idx;

  bool IsValid() { return cur_idx < end_idx; }

  void Next() { cur_idx += 2; }

  double Val() {
    union U {
      double d;
      long l;
    } u;
    u.l = ctx.tape[cur_idx + 1];
    return u.d;
  }
};

//+------------------------------------------------------------------+
//| CJsonNode: The Handle                                            |
//+------------------------------------------------------------------+
struct CJsonNode {
  CJsonContext *ctx;
  int idx;

  CJsonFastDoubleIterator begin_fast_double() {
    CJsonFastDoubleIterator it;
    it.ctx = ctx;
    if (!ctx || idx == -1 || ((ctx.tape[idx] >> 56) & 0xFF) != J_ARR) {
      it.cur_idx = 0;
      it.end_idx = 0;
      return it;
    }

    long head = ctx.tape[idx];
    it.cur_idx = idx + 1;
    it.end_idx = idx + (int)(head & 0xFFFFFFFF);
    return it;
  }

  CJsonNode operator[](string key) {
    if (!ctx || idx == -1)
      return GetNull();

    int klen = StringLen(key);
    uint h = 2166136261;
    for (int i = 0; i < klen; i++) {
      h = (h ^ (uchar)StringGetCharacter(key, i)) * 16777619;
    }

    long head = ctx.tape[idx];
    if (((head >> 56) & 0xFF) != J_OBJ)
      return GetNull();

    long size = head & 0xFFFFFFFF;
    int end = idx + (int)size;
    int cur = idx + 1;

    while (cur < end) {
      if ((uint)(ctx.tape[cur + 1] & 0xFFFFFFFF) == h) {
        CJsonNode node;
        node.ctx = ctx;
        node.idx = cur + 2;
        return node;
      }

      cur += 2 + (int)(ctx.tape[cur + 2] & 0xFFFFFFFF);
    }
    return GetNull();
  }

  CJsonNode operator[](int index) {
    if (!ctx || idx == -1 || ctx.GetType(idx) != J_ARR)
      return GetNull();
    int count = ctx.GetCount(idx);
    if (index < 0 || index >= count)
      return GetNull();

    int cur = idx + 1;
    for (int i = 0; i < index; i++)
      cur += ctx.GetStep(cur);

    CJsonNode node;
    node.ctx = ctx;
    node.idx = cur;
    return node;
  }

  CJsonIterator begin() {
    CJsonIterator it;
    it.ctx = ctx;
    if (!IsValid() ||
        (ctx.GetType(idx) != J_OBJ && ctx.GetType(idx) != J_ARR)) {
      it.cur_idx = 0;
      it.end_idx = 0;
      return it;
    }

    long head = ctx.tape[idx];
    long size = head & 0xFFFFFFFF;

    it.cur_idx = idx + 1;
    it.end_idx = idx + (int)size;
    it.total_count = ctx.GetCount(idx);
    it.steps_taken = 0;
    return it;
  }

  bool IsValid() { return (ctx != NULL && idx != -1); }
  bool IsNull() { return (!IsValid() || ctx.GetType(idx) == J_NULL); }
  bool IsString() { return (IsValid() && ctx.GetType(idx) == J_STR); }
  bool IsNumber() {
    return (IsValid() &&
            (ctx.GetType(idx) == J_INT || ctx.GetType(idx) == J_DBL));
  }
  bool IsArray() { return (IsValid() && ctx.GetType(idx) == J_ARR); }
  bool IsObject() { return (IsValid() && ctx.GetType(idx) == J_OBJ); }

  string ToString() { return IsValid() ? ctx.GetStr(idx) : ""; }
  long ToInt() {
    if (!IsValid())
      return 0;
    int t = ctx.GetType(idx);
    if (t == J_INT)
      return ctx.GetInt(idx);
    if (t == J_DBL)
      return (long)ctx.GetDouble(idx);
    return 0;
  }
  double ToDouble() {
    if (!IsValid())
      return double("nan");
    int t = ctx.GetType(idx);
    if (t == J_DBL)
      return ctx.GetDouble(idx);
    if (t == J_INT)
      return (double)ctx.GetInt(idx);
    return double("nan");
  }

  string ToString(string def) { return IsValid() ? ToString() : def; }
  long ToInt(long def) { return (IsValid() && IsNumber()) ? ToInt() : def; }
  double ToDouble(double def) {
    return (IsValid() && IsNumber()) ? ToDouble() : def;
  }
  bool ToBool(bool def) {
    return (IsValid() && ctx.GetType(idx) == J_BOOL) ? ctx.GetBool(idx) : def;
  }

  int Size() {
    if (!IsValid())
      return 0;
    int t = ctx.GetType(idx);
    if (t == J_ARR || t == J_OBJ)
      return ctx.GetCount(idx);
    return 0;
  }

  bool HasKey(string key) {
    return this[key].IsValid();
  }

  int GetKeys(string &dst[]) {
    if (!IsObject()) {
      ArrayResize(dst, 0);
      return 0;
    }
    int count = Size();
    ArrayResize(dst, count);

    CJsonIterator it = begin();
    int i = 0;
    while (it.IsValid() && i < count) {
      dst[i++] = it.Key();
      it.Next();
    }
    return count;
  }

  bool Equals(string val) {
    if (!IsValid() || ctx.GetType(idx) != J_STR)
      return false;

    long data = ctx.tape[idx + 1];
    int p = (int)(data >> 32);
    int l = (int)(data & 0xFFFFFFFF);

    if (StringLen(val) != l)
      return false;

    for (int i = 0; i < l; i++) {
      if (ctx.buffer[p + i] != (uchar)StringGetCharacter(val, i))
        return false;
    }
    return true;
  }

  string Serialize() {
    if (!IsValid())
      return "null";
    uchar out[];
    int pos = 0;
    int cap = 1024;
    ArrayResize(out, cap);
    ctx.WriteNode(idx, out, pos, cap);
    return CharArrayToString(out, 0, pos);
  }

private:
  CJsonNode GetNull() {
    CJsonNode n;
    n.ctx = NULL;
    n.idx = -1;
    return n;
  }
};

//+------------------------------------------------------------------+
//| CJsonIterator Implementation                                     |
//+------------------------------------------------------------------+
CJsonNode CJsonIterator::Val() {
  if (!IsValid()) {
    CJsonNode n;
    n.ctx = NULL;
    n.idx = -1;
    return n;
  }

  int type = ctx.GetType(cur_idx);
  if (type == J_KEY) {
    int val_idx = cur_idx + 2;
    CJsonNode n;
    n.ctx = ctx;
    n.idx = val_idx;
    return n;
  }
  CJsonNode n;
  n.ctx = ctx;
  n.idx = cur_idx;
  return n;
}

string CJsonIterator::Key() {
  if (!IsValid())
    return "";
  if (ctx.GetType(cur_idx) == J_KEY) {
    long kp = ctx.tape[cur_idx + 1];
    int kptr = (int)(kp >> 32);
    int len = 0;
    while (ctx.buffer[kptr + len] != '"')
      len++;
    return ctx.Unescape(kptr, len);
  }
  return "";
}

//+------------------------------------------------------------------+
//| CJsonBuilder: Production Grade                                   |
//+------------------------------------------------------------------+
class CJsonBuilder {
private:
  uchar m_buf[];
  int m_pos;
  int m_cap;
  bool m_stack_first[64];
  int m_sp;

public:
  CJsonBuilder(int initial_cap = 1024) {
    m_cap = initial_cap;
    ArrayResize(m_buf, m_cap);
    m_pos = 0;
    m_sp = 0;
    m_stack_first[0] = true;
  }

  void Clear() {
    m_pos = 0;
    m_sp = 0;
    m_stack_first[0] = true;
  }
  string Build() { return CharArrayToString(m_buf, 0, m_pos, CP_UTF8); }

  CJsonBuilder *Obj() {
    Comma();
    Put('{');
    if (m_sp < 63) {
      m_sp++;
      m_stack_first[m_sp] = true;
    }
    return &this;
  }

  CJsonBuilder *EndObj() {
    if (m_sp > 0)
      m_sp--;
    Put('}');
    m_stack_first[m_sp] = false;
    return &this;
  }

  CJsonBuilder *Arr() {
    Comma();
    Put('[');
    if (m_sp < 63) {
      m_sp++;
      m_stack_first[m_sp] = true;
    }
    return &this;
  }

  CJsonBuilder *EndArr() {
    if (m_sp > 0)
      m_sp--;
    Put(']');
    m_stack_first[m_sp] = false;
    return &this;
  }

  CJsonBuilder *Key(string k) {
    Comma();
    PutEncodedStr(k);
    Put(':');
    m_stack_first[m_sp] = true;
    return &this;
  }

  CJsonBuilder *Val(string v) {
    Comma();
    PutEncodedStr(v);
    return &this;
  }
  CJsonBuilder *Val(int v) {
    Comma();
    PutRaw(IntegerToString(v));
    return &this;
  }
  CJsonBuilder *Val(long v) {
    Comma();
    PutRaw(IntegerToString(v));
    return &this;
  }
  CJsonBuilder *Val(double v) {
    Comma();
    PutRaw(DoubleToString(v));
    return &this;
  }
  CJsonBuilder *Val(bool v) {
    Comma();
    const string boolean = v ? "true" : "false";
    PutRaw(boolean);
    return &this;
  }
  CJsonBuilder *ValidJson(const string& fragment) {
    Comma();
    PutRaw(fragment);
    return &this;
  }
  CJsonBuilder *Null() {
    Comma();
    PutRaw("null");
    return &this;
  }

private:
  void Comma() {
    if (!m_stack_first[m_sp])
      Put(',');
    m_stack_first[m_sp] = false;
  }

  void Put(uchar c) {
    if (m_pos >= m_cap)
      Expand(1);
    m_buf[m_pos++] = c;
  }

  void PutRaw(const string& s) {
    int l = StringLen(s);
    if (m_pos + l >= m_cap)
      Expand(l);
    StringToCharArray(s, m_buf, m_pos, l, CP_UTF8);
    m_pos += l;
  }

  void PutEncodedStr(string s) {
    Put('"');
    int l = StringLen(s);
    if (m_pos + l + 128 >= m_cap)
      Expand(l + 128);

    for (int i = 0; i < l; i++) {
      ushort c = StringGetCharacter(s, i);
      if (c >= 32 && c != '"' && c != '\\' && c < 127) {
        m_buf[m_pos++] = (uchar)c;
        continue;
      }

      if (c == '"') {
        Put('\\');
        Put('"');
      } else if (c == '\\') {
        Put('\\');
        Put('\\');
      } else if (c == '\x08') {
        Put('\\');
        Put('b');
      } else if (c == '\f') {
        Put('\\');
        Put('f');
      } else if (c == '\n') {
        Put('\\');
        Put('n');
      } else if (c == '\r') {
        Put('\\');
        Put('r');
      } else if (c == '\t') {
        Put('\\');
        Put('t');
      } else if (c < 32) {
        Put('\\');
        Put('u');
        Put('0');
        Put('0');
        Put(HexChar((c >> 4) & 0xF));
        Put(HexChar(c & 0xF));
      } else {
        uchar temp[];
        string one = ShortToString(c);
        int tlen = StringToCharArray(one, temp, 0, WHOLE_ARRAY, CP_UTF8);
        if (tlen > 0 && temp[tlen - 1] == 0)
          tlen--;
        if (m_pos + tlen > m_cap)
          Expand(tlen);
        ArrayCopy(m_buf, temp, m_pos, 0, tlen);
        m_pos += tlen;
      }
    }
    Put('"');
  }

  uchar HexChar(int v) { return (uchar)(v < 10 ? '0' + v : 'a' + (v - 10)); }

  void Expand(int add) {
    m_cap += add + 4096;
    ArrayResize(m_buf, m_cap);
  }
};

//+------------------------------------------------------------------+
//| CJson: The Document Root (Wrapper)                               |
//+------------------------------------------------------------------+
class CJson {
  CJsonContext ctx;

public:
  bool Parse(string json) { return ctx.Parse(json); }

  CJsonNode GetRoot() {
    if (ctx.tape_pos == 0) {
      CJsonNode n;
      n.ctx = NULL;
      n.idx = -1;
      return n;
    }
    CJsonNode n;
    n.ctx = &ctx;
    n.idx = 0;
    return n;
  }

  CJsonNode operator[](string key) { return GetRoot()[key]; }
  CJsonNode operator[](int index) { return GetRoot()[index]; }

  string Serialize(bool pretty = false) { return ctx.Serialize(pretty); }

  int GetLastError() { return ctx.last_error; }
  void GetErrorPos(int &line, int &col) {
    ctx.GetErrorLocation(ctx.err_pos, line, col);
  }
};

//+------------------------------------------------------------------+
//| Globals                                                          |
//+------------------------------------------------------------------+
CJson g_json_parser;
CJsonBuilder g_json_builder;


//+------------------------------------------------------------------+
#endif // FASTJSON_FASTJSON_MQH
