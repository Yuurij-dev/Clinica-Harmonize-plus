-- A categoria de despesa "Materiais/Estoque" passou a se chamar "Estoque".
UPDATE "Expense" SET "category" = 'Estoque' WHERE "category" = 'Materiais/Estoque';
UPDATE "RecurringExpense" SET "category" = 'Estoque' WHERE "category" = 'Materiais/Estoque';
