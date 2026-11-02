-- Family Budget: initial schema.
-- Money is always INTEGER minor units (cents, kopecks...). Exchange rates are exact decimal TEXT.
-- Dates of financial events are 'YYYY-MM-DD' TEXT; technical timestamps are unix milliseconds.
-- Every synchronizable row has: version (bumped on each change), updated_at, deleted_at (soft delete).

CREATE TABLE users (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    version     INTEGER NOT NULL DEFAULT 1,
    deleted_at  INTEGER
);

CREATE TABLE currencies (
    code      TEXT PRIMARY KEY CHECK (length(code) = 3 AND code = upper(code)),
    name      TEXT NOT NULL,
    symbol    TEXT NOT NULL,
    decimals  INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 4)
);

CREATE TABLE workspaces (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    kind           TEXT NOT NULL CHECK (kind IN ('personal', 'family')),
    base_currency  TEXT NOT NULL REFERENCES currencies(code),
    owner_user_id  TEXT NOT NULL REFERENCES users(id),
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1,
    deleted_at     INTEGER
);

CREATE TABLE workspace_members (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    user_id       TEXT REFERENCES users(id),
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    joined_on     TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    deleted_at    INTEGER
);
CREATE INDEX ix_members_workspace ON workspace_members(workspace_id);

CREATE TABLE accounts (
    id                     TEXT PRIMARY KEY,
    workspace_id           TEXT NOT NULL REFERENCES workspaces(id),
    name                   TEXT NOT NULL,
    kind                   TEXT NOT NULL CHECK (kind IN ('cash', 'debit_card', 'credit_card', 'bank', 'savings', 'ewallet', 'other')),
    currency               TEXT NOT NULL REFERENCES currencies(code),
    initial_balance_minor  INTEGER NOT NULL DEFAULT 0,
    credit_limit_minor     INTEGER CHECK (credit_limit_minor IS NULL OR credit_limit_minor >= 0),
    icon                   TEXT NOT NULL DEFAULT 'wallet',
    color                  TEXT NOT NULL DEFAULT '#14b8a6',
    is_active              INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    sort_order             INTEGER NOT NULL DEFAULT 0,
    created_at             INTEGER NOT NULL,
    updated_at             INTEGER NOT NULL,
    version                INTEGER NOT NULL DEFAULT 1,
    deleted_at             INTEGER
);
CREATE INDEX ix_accounts_workspace ON accounts(workspace_id);

-- Manual exchange rates: 1 unit of from_currency = rate units of to_currency (the workspace base).
CREATE TABLE exchange_rates (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL REFERENCES workspaces(id),
    from_currency  TEXT NOT NULL REFERENCES currencies(code),
    to_currency    TEXT NOT NULL REFERENCES currencies(code),
    rate           TEXT NOT NULL,
    rate_date      TEXT NOT NULL,
    source         TEXT NOT NULL DEFAULT 'manual',
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL,
    version        INTEGER NOT NULL DEFAULT 1,
    deleted_at     INTEGER,
    CHECK (from_currency <> to_currency)
);
CREATE UNIQUE INDEX ux_rates_day ON exchange_rates(workspace_id, from_currency, to_currency, rate_date)
    WHERE deleted_at IS NULL;

CREATE TABLE categories (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    parent_id     TEXT REFERENCES categories(id),
    kind          TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT 'tag',
    color         TEXT NOT NULL DEFAULT '#64748b',
    is_hidden     INTEGER NOT NULL DEFAULT 0 CHECK (is_hidden IN (0, 1)),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    deleted_at    INTEGER
);
CREATE INDEX ix_categories_workspace ON categories(workspace_id);

CREATE TABLE recurring_rules (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
    name            TEXT NOT NULL,
    kind            TEXT NOT NULL CHECK (kind IN ('expense', 'income')),
    amount_minor    INTEGER NOT NULL CHECK (amount_minor > 0),
    account_id      TEXT NOT NULL REFERENCES accounts(id),
    category_id     TEXT NOT NULL REFERENCES categories(id),
    member_id       TEXT REFERENCES workspace_members(id),
    comment         TEXT,
    interval_unit   TEXT NOT NULL CHECK (interval_unit IN ('day', 'week', 'month', 'year')),
    interval_count  INTEGER NOT NULL DEFAULT 1 CHECK (interval_count BETWEEN 1 AND 1000),
    start_date      TEXT NOT NULL,
    next_date       TEXT NOT NULL,
    end_date        TEXT,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'finished')),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    deleted_at      INTEGER
);
CREATE INDEX ix_recurring_workspace ON recurring_rules(workspace_id);

-- Header of a financial operation. Money itself lives in transaction_entries.
-- 'pending' operations come from recurring rules and do not touch balances until confirmed.
CREATE TABLE transactions (
    id                    TEXT PRIMARY KEY,
    workspace_id          TEXT NOT NULL REFERENCES workspaces(id),
    kind                  TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer', 'refund', 'adjustment')),
    status                TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'pending')),
    occurred_on           TEXT NOT NULL,
    category_id           TEXT REFERENCES categories(id),
    member_id             TEXT REFERENCES workspace_members(id),
    comment               TEXT,
    created_by            TEXT NOT NULL REFERENCES users(id),
    recurring_rule_id     TEXT REFERENCES recurring_rules(id),
    recurring_occurrence  TEXT,
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1,
    deleted_at            INTEGER
);
CREATE INDEX ix_tx_workspace_date ON transactions(workspace_id, occurred_on);
CREATE INDEX ix_tx_category ON transactions(category_id);
-- One occurrence of a recurring rule can produce at most one operation, ever (skipped ones stay soft-deleted).
CREATE UNIQUE INDEX ux_tx_recurring ON transactions(recurring_rule_id, recurring_occurrence)
    WHERE recurring_rule_id IS NOT NULL;

-- Ledger lines. amount_minor is signed, in the account currency; base_amount_minor is the same
-- value in the workspace base currency at the operation's historical rate (NULL only while pending
-- without a known rate). Balances are always SUM(amount_minor) + accounts.initial_balance_minor.
CREATE TABLE transaction_entries (
    id                 TEXT PRIMARY KEY,
    transaction_id     TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    workspace_id       TEXT NOT NULL REFERENCES workspaces(id),
    account_id         TEXT NOT NULL REFERENCES accounts(id),
    role               TEXT NOT NULL CHECK (role IN ('main', 'transfer_out', 'transfer_in', 'fee')),
    amount_minor       INTEGER NOT NULL,
    currency           TEXT NOT NULL REFERENCES currencies(code),
    base_amount_minor  INTEGER,
    rate               TEXT,
    rate_date          TEXT,
    rate_source        TEXT,
    created_at         INTEGER NOT NULL
);
CREATE INDEX ix_entries_tx ON transaction_entries(transaction_id);
CREATE INDEX ix_entries_account ON transaction_entries(account_id);

CREATE TABLE transfers (
    transaction_id     TEXT PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
    workspace_id       TEXT NOT NULL REFERENCES workspaces(id),
    from_account_id    TEXT NOT NULL REFERENCES accounts(id),
    to_account_id      TEXT NOT NULL REFERENCES accounts(id),
    from_amount_minor  INTEGER NOT NULL CHECK (from_amount_minor > 0),
    from_currency      TEXT NOT NULL REFERENCES currencies(code),
    to_amount_minor    INTEGER NOT NULL CHECK (to_amount_minor > 0),
    to_currency        TEXT NOT NULL REFERENCES currencies(code),
    rate               TEXT NOT NULL,
    fee_minor          INTEGER NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    CHECK (from_account_id <> to_account_id)
);

CREATE TABLE budgets (
    id                 TEXT PRIMARY KEY,
    workspace_id       TEXT NOT NULL REFERENCES workspaces(id),
    month              TEXT NOT NULL CHECK (length(month) = 7),
    total_limit_minor  INTEGER CHECK (total_limit_minor IS NULL OR total_limit_minor >= 0),
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    deleted_at         INTEGER
);
CREATE UNIQUE INDEX ux_budgets_month ON budgets(workspace_id, month) WHERE deleted_at IS NULL;

CREATE TABLE budget_limits (
    id            TEXT PRIMARY KEY,
    budget_id     TEXT NOT NULL REFERENCES budgets(id),
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    category_id   TEXT NOT NULL REFERENCES categories(id),
    limit_minor   INTEGER NOT NULL CHECK (limit_minor >= 0),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    deleted_at    INTEGER
);
CREATE UNIQUE INDEX ux_budget_limits ON budget_limits(budget_id, category_id) WHERE deleted_at IS NULL;

CREATE TABLE goals (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL REFERENCES workspaces(id),
    name          TEXT NOT NULL,
    target_minor  INTEGER NOT NULL CHECK (target_minor > 0),
    currency      TEXT NOT NULL REFERENCES currencies(code),
    target_date   TEXT,
    account_id    TEXT REFERENCES accounts(id),
    description   TEXT,
    icon          TEXT NOT NULL DEFAULT 'target',
    color         TEXT NOT NULL DEFAULT '#14b8a6',
    status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'archived')),
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    version       INTEGER NOT NULL DEFAULT 1,
    deleted_at    INTEGER
);
CREATE INDEX ix_goals_workspace ON goals(workspace_id);

-- Money set aside for a goal (negative = taken back). Optionally backed by a real transfer.
CREATE TABLE goal_contributions (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT NOT NULL REFERENCES goals(id),
    workspace_id    TEXT NOT NULL REFERENCES workspaces(id),
    amount_minor    INTEGER NOT NULL CHECK (amount_minor <> 0),
    contributed_on  TEXT NOT NULL,
    transaction_id  TEXT REFERENCES transactions(id),
    comment         TEXT,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    version         INTEGER NOT NULL DEFAULT 1,
    deleted_at      INTEGER
);
CREATE INDEX ix_contributions_goal ON goal_contributions(goal_id);

CREATE TABLE app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  INTEGER NOT NULL
);

-- Change journal for financial entities. Never stores secrets.
CREATE TABLE audit_log (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT REFERENCES workspaces(id),
    user_id       TEXT REFERENCES users(id),
    entity        TEXT NOT NULL,
    entity_id     TEXT NOT NULL,
    action        TEXT NOT NULL,
    old_value     TEXT,
    new_value     TEXT,
    at            INTEGER NOT NULL
);
CREATE INDEX ix_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX ix_audit_workspace ON audit_log(workspace_id, at);

-- Local change tracking for a future SyncProvider: which rows changed since the last sync.
CREATE TABLE sync_metadata (
    entity          TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    workspace_id    TEXT,
    local_version   INTEGER NOT NULL,
    synced_version  INTEGER,
    dirty           INTEGER NOT NULL DEFAULT 1 CHECK (dirty IN (0, 1)),
    changed_at      INTEGER NOT NULL,
    last_synced_at  INTEGER,
    PRIMARY KEY (entity, entity_id)
);
CREATE INDEX ix_sync_dirty ON sync_metadata(dirty, workspace_id);
