"""Pure seed constants (no framework imports) so they can be shared by the
seed script and the dependency-free acceptance tests.
"""
from datetime import date
from decimal import Decimal

# (lender, type, original_amount, interest_rate, rate_basis,
#  emi_monthly_pay, start_date, tenure_months, outstanding)
SEED_DEBTS = [
    ("Bajaj Finserv", "Vehicle Loan", "3448182", "0.155", "Annual", "73851", date(2024, 3, 2), 72, "2508384"),
    ("Bajaj Finserv", "Personal Loan", "1038723", "0.144", "Annual", "21627", date(2024, 4, 4), None, "1038723"),
    ("Fibe", "Personal Loan", "300000", "0.27", "Annual", "28805", date(2026, 1, 7), 12, "232335"),
    ("KreditBee", "Personal Loan", "50000", "0.15", "Annual", "5588", date(2026, 4, 2), 10, "44704"),
    ("Muthoot - Teju", "Gold Loan", "4400020", "0.12", "Annual", "109940", date(2025, 12, 14), None, "4400020"),
    ("Muthoot - Mom", "Gold Loan", "870000", "0.09", "Annual", "6000", date(2025, 6, 14), None, "870000"),
    ("MoneyView", "Personal Loan", "110000", "0.289", "Annual", "7604", date(2026, 4, 5), 18, "121664"),
    ("IDFC", "Personal Loan", "309056", "0.20", "Annual", "9406", date(2023, 5, 3), 48, "93821"),
    ("Hand Loan - Nag", "Hand Loan (Interest)", "5000000", "0.025", "Monthly", "125000", None, None, "5000000"),
    ("Hand Loan - Shyam", "Hand Loan (Interest)", "2000000", "0.025", "Monthly", "50000", None, None, "2000000"),
    ("Hand Loan - Revathi", "Hand Loan (Interest)", "3000000", "0.015", "Monthly", "45000", None, None, "3000000"),
    ("Hand Loan - Mamaya", "Hand Loan (Interest)", "19500000", "0.03", "Monthly", None, None, None, "19500000"),
]

SEED_GOAL = dict(
    start_date=date(2026, 6, 15),
    goal_duration_months=3,
    trading_days_per_week=5,
    savings_goal=Decimal("10000000"),
)
