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
