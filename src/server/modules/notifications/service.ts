import { prisma } from "@/server/db";

export type NotificationView = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  createdAt: string;
};

export async function listNotifications(userId: string, limit = 15): Promise<{ items: NotificationView[]; unreadCount: number }> {
  const [items, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: limit }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return {
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      // Seuls les liens internes sont restitués.
      link: n.link && n.link.startsWith("/") && !n.link.startsWith("//") ? n.link : null,
      read: n.readAt !== null,
      createdAt: n.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

export async function markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });
  return result.count;
}

/** Crée une notification dans l'espace de l'utilisateur. Les liens sont toujours internes. */
export async function notify(userId: string, input: { type: string; title: string; body?: string; link?: string; companyId?: string | null }): Promise<void> {
  await prisma.notification.create({
    data: {
      userId,
      companyId: input.companyId ?? null,
      type: input.type.slice(0, 50),
      title: input.title.slice(0, 191),
      body: input.body ?? null,
      link: input.link && input.link.startsWith("/") ? input.link.slice(0, 255) : null,
    },
  });
}
