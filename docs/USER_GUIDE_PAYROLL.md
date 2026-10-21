# Paper & Pixels — Employees, Time & Payroll Guide (owner / admin, 1 page)

Only admins see this part of the system. Employees only see the Time Clock and, if linked to a login, their **own** time records and payslips.

## 1. Set up each employee (once)
**People → Employees → + New employee**: name, position, hire date, **pay type** (daily rate or monthly salary) and amount, **pay frequency** (weekly or semi-monthly), **schedule** (e.g. 08:00–17:00, 60-min break, Mon–Sat), ID numbers (SSS, PhilHealth, Pag-IBIG, TIN).
Then on the employee page:
- **Time-clock PIN** — set a 4–6 digit PIN and tell the employee privately.
- **Recurring deductions** — add **SSS** with the monthly amount from the SSS table (schedule: *once a month*). Later you can add PhilHealth, Pag-IBIG or withholding tax the same way.
- **Linked login** (optional) — lets the employee see their own records under *My Time & Pay*.

## 2. Every day — Time Clock
Employees tap their name + PIN on **Time Clock** to time in and out. **A selfie is taken at every time in / out** (required by default — Settings → *Time clock selfie*). You see the photos as small round thumbnails next to each time in **Timekeeping**; click one to enlarge. Only admins can see them. Use a device with a front camera (tablet/phone, or a PC with a webcam) and open the app through its **https://** address — browsers block the camera on plain http local-network addresses. **The device's GPS location is also recorded at every punch** (required by default — Settings → *Time clock location*; the browser asks for location permission once per device). In **Timekeeping** a 📍 pin next to each time opens the spot in Google Maps; set **Settings → Shop location (lat, lng)** and the pin shows the distance from the shop instead, highlighted red when it is more than ~300 m away. Manual (admin-entered) times have no photo or location. **Buddy-punching check:** every punch also records which login was active and which device was used. Timekeeping shows a red **⚠ check** tag (hover for the reason) and the owner's dashboard lists today's cases when a punch was made from *another employee's* login, or when one phone punched for two people within 10 minutes. To clear a flag after you have looked at the selfies, open that day (click the time or the pencil) → **Time-clock check** → **Mark as checked** with a short note; the tag turns grey (✓ checked) and leaves the dashboard alert (you can re-open it). Tip: log the shop PC / kiosk tablet in with a login that is not linked to any employee (e.g. the `cashier` account) so normal kiosk punches are not flagged. Late, undertime and overtime are computed from their schedule (grace period in **Settings**).

## 3. Check time records
**People → Timekeeping** shows today's attendance (present, late, absent, incomplete). Fix forgotten time-outs, mark **paid leave**, and **approve overtime** — overtime is only paid when approved. Every correction needs a reason and is logged. Add holidays under **Timekeeping → Holidays** (there's a button for the 2026 list — always verify against the official proclamation).

## 4. Cash advances ("bale")
Employee page → **Cash advances → Add**: amount and how much to deduct per payroll. It's deducted automatically until fully paid.

## 5. Run payroll
1. **People → Payroll → + New payroll run** → choose weekly or semi-monthly and the period (e.g. Oct 1–15).
2. Review the register and each payslip. Warnings show incomplete records or unapproved OT — fix them in Timekeeping, then **Recalculate**.
3. Add allowances, bonuses or other deductions on a payslip if needed.
4. **Finalize** (locks it and applies cash-advance repayments) → pay the employees → **Mark as paid** (records the total as a *Salaries* expense so the profit report is correct).
5. **Print** payslips (one per page) for the employees to sign, and the payroll register for your files.
Made a mistake after finalizing? **Void** the run (cash-advance repayments and the expense are reversed) and create it again.

## 6. Incidents & violations (private)
Employee page → **Incidents & violations**: date, type (incident, violation, warning), severity, what happened and the action taken. **Employees can never see these.**

## 7. 13th-month pay
**Payroll → 13th month pay** shows each employee's total basic pay for the year ÷ 12. Pay it on or before **December 24**.

> Pay rules used: overtime 125% (rest day/special holiday 169%, regular holiday 260%), rest day work 130%, special holiday work 130%, regular holiday work 200%, unworked regular holiday paid for daily-rated employees. Check with your accountant for special cases.
