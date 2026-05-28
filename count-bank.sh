#!/bin/bash
cd /opt/vietravel-exam
python3 << 'PYEOF'
import json
b = json.load(open("data/banks.json"))
sl = len(b["BANK_STAFF"]["listening"])
sr = len(b["BANK_STAFF"]["reading"])
sw = len(b["BANK_STAFF"]["writing"])
ml = len(b["BANK_OFFICE_MGR"]["listening"])
mr = len(b["BANK_OFFICE_MGR"]["reading"])
mw = len(b["BANK_OFFICE_MGR"]["writing"])
print(f"BANK_STAFF: L={sl} R={sr} W={sw} subtotal={sl+sr+sw}")
print(f"BANK_OFFICE_MGR: L={ml} R={mr} W={mw} subtotal={ml+mr+mw}")
print(f"TOTAL in banks.json: {sl+sr+sw+ml+mr+mw}")

# Also check writing-bank.json
try:
    wb = json.load(open("data/writing-bank.json"))
    for k, v in wb.items():
        if isinstance(v, list):
            print(f"writing-bank.json [{k}]: {len(v)} items")
except:
    print("No writing-bank.json")
PYEOF
