# Round 11: statement lines on the master lines

Migration `supabase/migrations/20261130010000_round11_statement_lines.sql` (Hashim, Nov 14, 2026). One row per GIFI code (the `.00` line); every sub-line carries the same statement line as its `.00` line. "Calculated total" lines are left out.

Also corrected: two GIFI names cut short when CRA's list was read in: 1775 "Accumulated amortization of computer" is now "... of computer equipment/software", and 1919 "Accumulated amortization of leasehold" is now "... of leasehold improvements".

## 1. Changed by the migration (88 lines)

| GIFI | GIFI name | Statement line before | Statement line now |
|---|---|---|---|
| 1062 | Trade accounts receivable | Allowance for doubtful accounts | Trade accounts receivable |
| 1601 | Land improvements | Land | Land improvements |
| 1602 | Accumulated amortization of land improvements | Land | Accumulated amortization of land improvements |
| 1684 | Buildings under construction | Accumulated amortization of buildings | Buildings under construction |
| 1742 | Motor vehicles | Accumulated amortization of machinery, equipment, furniture, and fixtures | Motor vehicles |
| 1743 | Accumulated amortization of motor vehicles | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of motor vehicles |
| 1744 | Tools and dies | Accumulated amortization of machinery, equipment, furniture, and fixtures | Tools and dies |
| 1745 | Accumulated amortization of tools and dies | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of tools and dies |
| 1746 | Construction and excavating equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Construction and excavating equipment |
| 1747 | Accumulated amortization of construction and excavating equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of construction and excavating equipment |
| 1768 | Signs | Accumulated amortization of machinery, equipment, furniture, and fixtures | Signs |
| 1769 | Accumulated amortization of signs | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of signs |
| 1770 | Small tools | Accumulated amortization of machinery, equipment, furniture, and fixtures | Small tools |
| 1771 | Accumulated amortization of small tools | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of small tools |
| 1772 | Radio and communication equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Radio and communication equipment |
| 1773 | Accumulated amortization of radio and communication equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of radio and communication equipment |
| 1774 | Computer equipment/software | Accumulated amortization of machinery, equipment, furniture, and fixtures | Computer equipment/software |
| 1775 | Accumulated amortization of computer equipment/software | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of computer equipment/software |
| 1783 | Transportation equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Transportation equipment |
| 1784 | Accumulated amortization of transportation equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of transportation equipment |
| 1785 | Other machinery and equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Other machinery and equipment |
| 1786 | Accumulated amortization of other machinery and equipment | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of other machinery and equipment |
| 1787 | Furniture and fixtures | Accumulated amortization of machinery, equipment, furniture, and fixtures | Furniture and fixtures |
| 1788 | Accumulated amortization of furniture and fixtures | Accumulated amortization of machinery, equipment, furniture, and fixtures | Accumulated amortization of furniture and fixtures |
| 1904 | Asphalt and parking areas | Accumulated amortization of other tangible capital assets | Asphalt and parking areas |
| 1905 | Accumulated amortization of asphalt and parking areas | Accumulated amortization of other tangible capital assets | Accumulated amortization of asphalt and parking areas |
| 1908 | Fences | Accumulated amortization of other tangible capital assets | Fences |
| 1909 | Accumulated amortization of fences | Accumulated amortization of other tangible capital assets | Accumulated amortization of fences |
| 1910 | Capital leases – Buildings | Accumulated amortization of other tangible capital assets | Capital leases – buildings |
| 1911 | Accumulated amortization of capital leases – Buildings | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – buildings |
| 1912 | Capital leases – Equipment | Accumulated amortization of other tangible capital assets | Capital leases – equipment |
| 1913 | Accumulated amortization of capital leases – Equipment | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – equipment |
| 1914 | Capital leases – Vehicles | Accumulated amortization of other tangible capital assets | Capital leases – vehicles |
| 1915 | Accumulated amortization of capital leases – Vehicles | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – vehicles |
| 1916 | Capital leases – Others | Accumulated amortization of other tangible capital assets | Capital leases – others |
| 1917 | Accumulated amortization of capital leases – Others | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – others |
| 1918 | Leasehold improvements | Accumulated amortization of other tangible capital assets | Leasehold improvements |
| 1919 | Accumulated amortization of leasehold improvements | Accumulated amortization of other tangible capital assets | Accumulated amortization of leasehold improvements |
| 1920 | Other capital assets under construction | Accumulated amortization of other tangible capital assets | Other capital assets under construction |
| 2012 | Goodwill | Accumulated amortization of intangible assets | Goodwill |
| 2013 | Accumulated amortization of goodwill | Accumulated amortization of intangible assets | Accumulated amortization of goodwill |
| 2016 | Licences | Accumulated amortization of intangible assets | Licences |
| 2017 | Accumulated amortization of licences | Accumulated amortization of intangible assets | Accumulated amortization of licences |
| 2018 | Incorporation costs (corporations only) | Accumulated amortization of intangible assets | Incorporation costs (corporations only) |
| 2019 | Accumulated amortization of incorporation costs | Accumulated amortization of intangible assets | Accumulated amortization of incorporation costs |
| 2020 | Trademarks/patents | Accumulated amortization of intangible assets | Trademarks/patents |
| 2021 | Accumulated amortization of trademarks/patents | Accumulated amortization of intangible assets | Accumulated amortization of trademarks/patents |
| 2022 | Customer lists | Accumulated amortization of intangible assets | Customer lists |
| 2023 | Accumulated amortization of customer lists | Accumulated amortization of intangible assets | Accumulated amortization of customer lists |
| 2024 | Rights | Accumulated amortization of intangible assets | Rights |
| 2025 | Accumulated amortization of rights | Accumulated amortization of intangible assets | Accumulated amortization of rights |
| 2026 | Research and development | Accumulated amortization of intangible assets | Research and development |
| 2027 | Accumulated amortization of research and development | Accumulated amortization of intangible assets | Accumulated amortization of research and development |
| 2181 | Due from individual shareholder(s) | Due from shareholder(s)/director(s) | Due from individual shareholder(s) |
| 2182 | Due from corporate shareholder(s) | Due from shareholder(s)/director(s) | Due from corporate shareholder(s) |
| 2183 | Due from director(s) | Due from shareholder(s)/director(s) | Due from director(s) |
| 2241 | Due from/investment in Canadian related parties | Due from/investment in related parties | Due from/investment in Canadian related parties |
| 2242 | Shares in Canadian related corporations | Due from/investment in related parties | Shares in Canadian related corporations |
| 2243 | Loans/advances to Canadian related corporations | Due from/investment in related parties | Loans/advances to Canadian related corporations |
| 2244 | Investment in Canadian related corporations at cost | Due from/investment in related parties | Investment in Canadian related corporations at cost |
| 2245 | Investment in Canadian related corporations at equity | Due from/investment in related parties | Investment in Canadian related corporations at equity |
| 2246 | Due from/investment in foreign related parties | Due from/investment in related parties | Due from/investment in foreign related parties |
| 2247 | Shares in foreign related corporations | Due from/investment in related parties | Shares in foreign related corporations |
| 2248 | Loans/advances to foreign related corporations | Due from/investment in related parties | Loans/advances to foreign related corporations |
| 2249 | Investment in foreign related corporations at cost | Due from/investment in related parties | Investment in foreign related corporations at cost |
| 2250 | Investment in foreign related corporations at equity | Due from/investment in related parties | Investment in foreign related corporations at equity |
| 2301 | Foreign shares | Long-term investments | Foreign shares |
| 2302 | Other types of foreign investments | Long-term investments | Other types of foreign investments |
| 2303 | Canadian shares | Long-term investments | Canadian shares |
| 2304 | Government of Canada debt | Long-term investments | Government of Canada debt |
| 2305 | Canadian, provincial, and municipal government debt | Long-term investments | Canadian, provincial, and municipal government debt |
| 2306 | Canadian corporate bonds and debentures | Long-term investments | Canadian corporate bonds and debentures |
| 2311 | Other Canadian long-term investments | Long-term investments | Other Canadian long-term investments |
| 2421 | Future (deferred) income taxes (corporations only) | Other long-term assets | Future (deferred) income taxes (corporations only) |
| 2423 | Deferred unrealized exchange losses | Other long-term assets | Deferred unrealized exchange losses |
| 2424 | Other deferred items/charges | Other long-term assets | Other deferred items/charges |
| 2425 | Accumulated amortization of deferred charges | Other long-term assets | Accumulated amortization of deferred charges |
| 2426 | Reserve fund | Other long-term assets | Reserve fund |
| 2427 | Cash surrender value of life insurance | Other long-term assets | Cash surrender value of life insurance |
| 2621 | Trade payables | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2622 | Trade payables to related parties | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2623 | Holdbacks payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2624 | Wages payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2625 | Management fees payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2626 | Bonuses payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2627 | Employee deductions payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2628 | Withholding taxes payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2707 | Credit card loans | Short-term debt | Credit cards payable |

## 2. Statement line still differs from the GIFI name (208 lines)

Old = before this PR, new = now. Most are intended groupings (several GIFI lines printing as one statement line). Check each one.

| GIFI | GIFI name | Statement line (old) | Statement line (new) |
|---|---|---|---|
| 1000 | Cash and deposits | Cash and cash equivalents | Cash and cash equivalents |
| 1001 | Cash | Cash and cash equivalents | Cash and cash equivalents |
| 1002 | Deposits in Canadian banks and institutions – Canadian currency | Cash and cash equivalents | Cash and cash equivalents |
| 1003 | Deposits in Canadian banks and institutions – Foreign currency | Cash and cash equivalents | Cash and cash equivalents |
| 1004 | Deposits in foreign banks – Canadian currency | Cash and cash equivalents | Cash and cash equivalents |
| 1005 | Deposits in foreign banks – Foreign currency | Cash and cash equivalents | Cash and cash equivalents |
| 1007 | Other cash-like instruments | Cash and cash equivalents | Cash and cash equivalents |
| 1061 | Allowance for doubtful accounts | Accounts receivable | Accounts receivable |
| 1063 | Allowance for doubtful trade accounts receivable | Accounts receivable | Accounts receivable |
| 1064 | Trade accounts receivable from related parties | Accounts receivable | Accounts receivable |
| 1065 | Allowance for doubtful trade accounts receivable from related parties | Accounts receivable | Accounts receivable |
| 1066 | Taxes receivable | Accounts receivable | Accounts receivable |
| 1067 | Interest receivable | Accounts receivable | Accounts receivable |
| 1068 | Holdbacks receivable | Accounts receivable | Accounts receivable |
| 1069 | Leases receivable | Accounts receivable | Accounts receivable |
| 1070 | Allowance for doubtful amounts contained in leases receivable | Accounts receivable | Accounts receivable |
| 1071 | Accounts receivable from employees | Accounts receivable | Accounts receivable |
| 1072 | Allowance for doubtful accounts receivable from employees | Accounts receivable | Accounts receivable |
| 1121 | Inventory of goods for sale | Inventories | Inventories |
| 1122 | Inventory parts and supplies | Inventories | Inventories |
| 1123 | Inventory properties | Inventories | Inventories |
| 1125 | Work in progress | Inventories | Inventories |
| 1126 | Raw materials | Inventories | Inventories |
| 1181 | Canadian term deposits | Short-term investments | Short-term investments |
| 1182 | Canadian shares | Short-term investments | Short-term investments |
| 1183 | Canadian bonds | Short-term investments | Short-term investments |
| 1184 | Canadian treasury bills | Short-term investments | Short-term investments |
| 1186 | Other short-term Canadian investments | Short-term investments | Short-term investments |
| 1187 | Short-term foreign investments | Short-term investments | Short-term investments |
| 1241 | Demand loans receivable | Loans and notes receivable | Loans and notes receivable |
| 1242 | Other loans receivable | Loans and notes receivable | Loans and notes receivable |
| 1243 | Notes receivable | Loans and notes receivable | Loans and notes receivable |
| 1244 | Mortgages receivable | Loans and notes receivable | Loans and notes receivable |
| 1301 | Due from individual shareholder(s) | Due from shareholder(s)/director(s) | Due from shareholder(s)/director(s) |
| 1302 | Due from corporate shareholder(s) | Due from shareholder(s)/director(s) | Due from shareholder(s)/director(s) |
| 1303 | Due from director(s) | Due from shareholder(s)/director(s) | Due from shareholder(s)/director(s) |
| 1401 | Demand notes from related parties | Due from/investment in related parties | Due from/investment in related parties |
| 1402 | Interest receivable from related parties | Due from/investment in related parties | Due from/investment in related parties |
| 1403 | Loans/advances due from related parties | Due from/investment in related parties | Due from/investment in related parties |
| 1480 | Other current assets | Prepaid expenses and deposits | Prepaid expenses and deposits |
| 1481 | Future (deferred) income taxes (corporations only) | Other current assets | Other current assets |
| 1482 | Accrued investment income | Other current assets | Other current assets |
| 1483 | Taxes recoverable/refundable | Other current assets | Other current assets |
| 1484 | Prepaid expenses | Other current assets | Other current assets |
| 1486 | Security/tender deposits | Other current assets | Other current assets |
| 1910 | Capital leases – Buildings | Accumulated amortization of other tangible capital assets | Capital leases – buildings |
| 1911 | Accumulated amortization of capital leases – Buildings | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – buildings |
| 1912 | Capital leases – Equipment | Accumulated amortization of other tangible capital assets | Capital leases – equipment |
| 1913 | Accumulated amortization of capital leases – Equipment | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – equipment |
| 1914 | Capital leases – Vehicles | Accumulated amortization of other tangible capital assets | Capital leases – vehicles |
| 1915 | Accumulated amortization of capital leases – Vehicles | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – vehicles |
| 1916 | Capital leases – Others | Accumulated amortization of other tangible capital assets | Capital leases – others |
| 1917 | Accumulated amortization of capital leases – Others | Accumulated amortization of other tangible capital assets | Accumulated amortization of capital leases – others |
| 2620 | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2621 | Trade payables | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2622 | Trade payables to related parties | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2623 | Holdbacks payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2624 | Wages payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2625 | Management fees payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2626 | Bonuses payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2627 | Employee deductions payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2628 | Withholding taxes payable | Amounts payable and accrued liabilities | Accounts payable and accrued liabilities |
| 2629 | Interest payable | Amounts payable and accrued liabilities | Amounts payable and accrued liabilities |
| 2680 | Taxes payable | Income taxes payable | Income taxes payable |
| 2701 | Loans from Canadian banks | Short-term debt | Short-term debt |
| 2705 | Cheques and other items in transit | Short-term debt | Short-term debt |
| 2706 | Lien notes | Short-term debt | Short-term debt |
| 2707 | Credit card loans | Short-term debt | Credit cards payable |
| 2780 | Due to shareholder(s)/director(s) | Due to shareholder | Due to shareholder |
| 2781 | Due to individual shareholder(s) | Due to shareholder(s)/director(s) | Due to shareholder(s)/director(s) |
| 2782 | Due to corporate shareholder(s) | Due to shareholder(s)/director(s) | Due to shareholder(s)/director(s) |
| 2783 | Due to director(s) | Due to shareholder(s)/director(s) | Due to shareholder(s)/director(s) |
| 2861 | Demand notes due to related parties | Due to related parties | Due to related parties |
| 2862 | Interest payable to related parties | Due to related parties | Due to related parties |
| 2863 | Advances due to related parties | Due to related parties | Due to related parties |
| 2961 | Deposits received | Other current liabilities | Other current liabilities |
| 2962 | Dividends payable | Other current liabilities | Other current liabilities |
| 2963 | Future (deferred) income taxes (corporations only) | Other current liabilities | Other current liabilities |
| 2964 | Reserves for guarantees, warranties, or indemnities | Other current liabilities | Other current liabilities |
| 2965 | General provisions/reserves | Other current liabilities | Other current liabilities |
| 3141 | Mortgages | Long-term debt | Long-term debt |
| 3143 | Chartered bank loan | Long-term debt | Long-term debt |
| 3144 | Credit Union/Caisse Populaire loan | Long-term debt | Long-term debt |
| 3145 | Provincial or territorial government loan | Long-term debt | Long-term debt |
| 3146 | Supply company loan | Long-term debt | Long-term debt |
| 3147 | Private loan | Long-term debt | Long-term debt |
| 3149 | Line of credit | Long-term debt | Long-term debt |
| 3152 | Lien notes | Long-term debt | Long-term debt |
| 3260 | Due to shareholder(s)/director(s) | Due to shareholder | Due to shareholder |
| 3261 | Due to individual shareholder(s) | Due to shareholder(s)/director(s) | Due to shareholder(s)/director(s) |
| 3262 | Due to corporate shareholder(s) | Due to shareholder(s)/director(s) | Due to shareholder(s)/director(s) |
| 3263 | Due to director(s) | Due to shareholder(s)/director(s) | Due to shareholder(s)/director(s) |
| 3301 | Amounts owing to related Canadian parties | Due to related parties | Due to related parties |
| 3302 | Amounts owing to related foreign parties | Due to related parties | Due to related parties |
| 3321 | Long-term obligations/commitments/capital leases | Other long-term liabilities | Other long-term liabilities |
| 3322 | Reserves for guarantees, warranties, or indemnities | Other long-term liabilities | Other long-term liabilities |
| 3325 | General provisions/reserves | Other long-term liabilities | Other long-term liabilities |
| 3326 | Preference shares restated (corporations only) | Other long-term liabilities | Other long-term liabilities |
| 3328 | Deferred revenue from incomplete contracts | Other long-term liabilities | Other long-term liabilities |
| 3500 | Common shares | Share capital | Share capital |
| 3541 | Contributed surplus | Contributed and other surplus | Contributed and other surplus |
| 3542 | Appraisal surplus | Contributed and other surplus | Contributed and other surplus |
| 3543 | General reserve | Contributed and other surplus | Contributed and other surplus |
| 3701 | Cash dividends | Dividends declared | Dividends declared |
| 3741 | Share redemptions | Other items affecting retained earnings | Other items affecting retained earnings |
| 3743 | Currency adjustments | Other items affecting retained earnings | Other items affecting retained earnings |
| 3744 | Unusual revenue items | Other items affecting retained earnings | Other items affecting retained earnings |
| 8000 | Trade sales of goods and services | Revenue | Revenue |
| 8091 | Interest from foreign sources | Investment revenue | Investment revenue |
| 8092 | Interest from Canadian bonds and debentures | Investment revenue | Investment revenue |
| 8093 | Interest from Canadian mortgage loans | Investment revenue | Investment revenue |
| 8094 | Interest from other Canadian sources | Investment revenue | Investment revenue |
| 8095 | Dividend income | Investment revenue | Investment revenue |
| 8096 | Dividends from Canadian sources | Investment revenue | Investment revenue |
| 8097 | Dividends from foreign sources | Investment revenue | Investment revenue |
| 8121 | Commission income on real estate transactions | Commission revenue | Commission revenue |
| 8141 | Real estate rental revenue | Rental revenue | Rental revenue |
| 8211 | Realized gains/losses on sale of investments | Realized gains/losses on disposal of assets | Realized gains/losses on disposal of assets |
| 8231 | Foreign exchange gains/losses | Other revenue | Other revenue |
| 8232 | Income/loss of subsidiaries/affiliates | Other revenue | Other revenue |
| 8234 | Income/loss of joint ventures | Other revenue | Other revenue |
| 8235 | Income/loss of partnerships | Other revenue | Other revenue |
| 8236 | Realization of deferred revenues | Other revenue | Other revenue |
| 8237 | Royalty income other than resource | Other revenue | Other revenue |
| 8239 | Management and administration fees | Other revenue | Other revenue |
| 8240 | Telecommunications revenue | Other revenue | Other revenue |
| 8241 | Consulting fees | Other revenue | Other revenue |
| 8242 | Subsidies and grants | Other revenue | Other revenue |
| 8248 | Insurance recoveries | Other revenue | Other revenue |
| 8249 | Expense recoveries | Other revenue | Other revenue |
| 8250 | Bad debt recoveries | Other revenue | Other revenue |
| 8301 | Opening inventory – Finished goods | Opening inventory | Opening inventory |
| 8302 | Opening inventory – Raw materials | Opening inventory | Opening inventory |
| 8303 | Opening inventory – Goods in process | Opening inventory | Opening inventory |
| 8451 | Equipment hire and operation | Other direct costs | Other direct costs |
| 8456 | Royalty costs | Other direct costs | Other direct costs |
| 8457 | Freight-in and duty | Other direct costs | Other direct costs |
| 8458 | Inventory write-down | Other direct costs | Other direct costs |
| 8459 | Direct cost amortization of tangible assets | Other direct costs | Other direct costs |
| 8461 | Overhead expenses allocated to cost of sales | Other direct costs | Other direct costs |
| 8501 | Closing inventory – Finished goods | Closing inventory | Closing inventory |
| 8502 | Closing inventory – Raw materials | Closing inventory | Closing inventory |
| 8503 | Closing inventory – Goods in process | Closing inventory | Closing inventory |
| 8520 | Advertising and promotion | Advertising | Advertising |
| 8621 | Group insurance benefits | Employee benefits | Employee benefits |
| 8622 | Employer’s portion of employee benefits | Employee benefits | Employee benefits |
| 8623 | Contributions to deferred income plans | Employee benefits | Employee benefits |
| 8670 | Amortization of tangible assets | Amortization | Amortization |
| 8691 | Life insurance on executives | Insurance | Insurance |
| 8711 | Interest on short-term debt | Interest and bank charges | Interest and bank charges |
| 8712 | Interest on bonds and debentures | Interest and bank charges | Interest and bank charges |
| 8713 | Interest on mortgages | Interest and bank charges | Interest and bank charges |
| 8714 | Interest on long-term debt | Interest and bank charges | Interest and bank charges |
| 8715 | Bank charges | Interest and bank charges | Interest and bank charges |
| 8716 | Credit card charges | Interest and bank charges | Interest and bank charges |
| 8717 | Collection and credit costs | Interest and bank charges | Interest and bank charges |
| 8761 | Memberships | Business taxes, licences, and memberships | Business taxes, licences, and memberships |
| 8762 | Business taxes | Business taxes, licences, and memberships | Business taxes, licences, and memberships |
| 8763 | Franchise fees | Business taxes, licences, and memberships | Business taxes, licences, and memberships |
| 8764 | Government fees | Business taxes, licences, and memberships | Business taxes, licences, and memberships |
| 8811 | Office stationery and supplies | Office expenses | Office expenses |
| 8812 | Office utilities | Office expenses | Office expenses |
| 8813 | Data processing | Office expenses | Office expenses |
| 8861 | Legal fees | Professional fees | Professional fees |
| 8862 | Accounting fees | Professional fees | Professional fees |
| 8863 | Consulting fees | Professional fees | Professional fees |
| 8864 | Architect fees | Professional fees | Professional fees |
| 8865 | Appraisal fees | Professional fees | Professional fees |
| 8866 | Laboratory fees | Professional fees | Professional fees |
| 8867 | Medical fees | Professional fees | Professional fees |
| 8868 | Veterinary fees | Professional fees | Professional fees |
| 8869 | Brokerage fees | Professional fees | Professional fees |
| 8870 | Transfer fees | Professional fees | Professional fees |
| 8871 | Management and administration fees | Professional fees | Professional fees |
| 8873 | Registrar and transfer agent fees | Professional fees | Professional fees |
| 8874 | Restructuring costs | Professional fees | Professional fees |
| 8876 | Training expense | Professional fees | Professional fees |
| 8910 | Rental | Rent | Rent |
| 8911 | Real estate rental | Rental | Rental |
| 8912 | Occupancy costs | Rental | Rental |
| 8913 | Condominium fees | Rental | Rental |
| 8914 | Equipment rental | Rental | Rental |
| 8915 | Motor vehicle rentals | Rental | Rental |
| 8917 | Storage | Rental | Rental |
| 8961 | Repairs and maintenance – Buildings | Repairs and maintenance | Repairs and maintenance |
| 8962 | Repairs and maintenance – Vehicles | Repairs and maintenance | Repairs and maintenance |
| 8964 | Repairs and maintenance – Machinery and equipment | Repairs and maintenance | Repairs and maintenance |
| 9013 | Security | Other repairs and maintenance | Other repairs and maintenance |
| 9014 | Garbage removal | Other repairs and maintenance | Other repairs and maintenance |
| 9061 | Commissions | Salaries and wages | Salaries and wages |
| 9063 | Bonuses | Salaries and wages | Salaries and wages |
| 9064 | Directors fees | Salaries and wages | Salaries and wages |
| 9065 | Management salaries | Salaries and wages | Salaries and wages |
| 9066 | Employee salaries | Salaries and wages | Salaries and wages |
| 9131 | Small tools | Supplies | Supplies |
| 9132 | Shop expense | Supplies | Supplies |
| 9133 | Uniforms | Supplies | Supplies |
| 9134 | Laundry | Supplies | Supplies |
| 9135 | Food and catering | Supplies | Supplies |
| 9151 | Upgrade | Computer-related expenses | Computer-related expenses |
| 9152 | Internet | Computer-related expenses | Computer-related expenses |
| 9201 | Meetings and conventions | Travel expenses | Travel expenses |
| 9221 | Electricity | Utilities | Utilities |
| 9222 | Water | Utilities | Utilities |
| 9223 | Heat | Utilities | Utilities |
| 9224 | Fuel costs | Utilities | Utilities |
| 9225 | Telephone and telecommunications | Telecommunications | Telecommunications |
| 9281 | Vehicle expenses | Vehicle | Vehicle |
