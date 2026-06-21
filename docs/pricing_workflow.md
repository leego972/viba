# VIBA Pricing Workflow

Default mode: use the cheapest adequate path.

Multi-agent mode: when the user adds more AI agents, VIBA divides the work.

Example request:

Please lookup all relevant builder apps, compare prices, and place our project in the mid price range.

Default workflow:

1. Search public web for builder apps.
2. Take the first 10 relevant results.
3. Inspect public pricing pages.
4. Extract monthly and yearly prices.
5. Normalize yearly prices into monthly equivalents.
6. Calculate min, max, average and median.
7. Recommend a mid-range monthly and yearly price.
8. Return sources, confidence and limitations.

Multi-agent workflow:

1. Research agent finds relevant competitors.
2. Pricing agent extracts plans and prices.
3. Strategy agent recommends price position.
4. Reviewer agent checks weak sources and extraction errors.
5. VIBA merges the outputs into one report.
6. VIBA logs the workflow.

Route:

POST /api/pricing-research/benchmark

Input example:

{
  "category": "AI builder apps",
  "topN": 10
}

Output includes sources, prices, sample size, priced source count, min monthly, max monthly, average monthly, median monthly, suggested monthly price, and suggested yearly price.
