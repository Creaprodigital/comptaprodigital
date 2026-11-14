import type { CompanyAccess } from "@/server/rbac/service";
import { listProducts, listVatRates } from "@/server/modules/products/service";

/** Données de référence du formulaire de devis ou de facture. */
export async function loadEditorData(access: CompanyAccess) {
  const [customers, products, vatRates] = await Promise.all([
    access.db.customer.findMany({ where: { archivedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, paymentTermDays: true }, take: 2000 }),
    listProducts(access, { pageSize: 100 }),
    listVatRates(access),
  ]);
  return {
    companyId: access.company.id,
    currency: access.company.currency,
    franchise: access.company.vatRegime === "FRANCHISE",
    customers,
    products: products.items,
    vatRates,
    defaults: { paymentTermDays: access.company.defaultPaymentTermDays, validityDays: access.company.quoteValidityDays },
    canCreateCustomer: access.permissions.has("customers:write"),
  };
}
