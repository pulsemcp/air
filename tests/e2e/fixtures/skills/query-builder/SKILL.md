# Query Builder

Build and optimize SQL queries for the analytics data warehouse.

## Guidelines

- Always use CTEs for complex queries
- Include EXPLAIN ANALYZE output for queries touching large tables
- Prefer window functions over self-joins
