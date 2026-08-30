-- Category names are user-managed. Enforce case-insensitive uniqueness at the
-- database layer so concurrent Admin requests cannot create equivalent names.
CREATE UNIQUE INDEX "categories_name_case_insensitive_key" ON "categories" (LOWER("name"));
