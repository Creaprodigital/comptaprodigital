"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellIcon } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Notification = { id: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string };
type Payload = { items: Notification[]; unreadCount: number };

export function NotificationBell() {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>("/me/notifications"));
    } catch {
      // Silencieux : la cloche n'est pas critique et sera rechargée à la prochaine ouverture.
    }
  }, []);

  // Chargement initial du compteur de notifications non lues.
  useEffect(() => {
    let cancelled = false;
    api<Payload>("/me/notifications")
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      await load();
    } else if (data && data.unreadCount > 0) {
      // À la fermeture, tout ce qui a été affiché est considéré comme lu.
      await api("/me/notifications/read", { method: "POST", body: {} }).catch(() => undefined);
      await load();
    }
  }

  const unread = data?.unreadCount ?? 0;

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread > 0 ? `Notifications (${unread} non lues)` : "Notifications"}>
          <BellIcon className="size-[18px]" />
          {unread > 0 ? (
            <span className="absolute top-1.5 right-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-bold text-white">
              {unread > 9 ? "9+" : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <p className="border-b px-4 py-3 text-sm font-semibold">Notifications</p>
        {!data ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Chargement…</p>
        ) : data.items.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune notification pour le moment.</p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {data.items.map((item) => {
              const content = (
                <>
                  <p className="flex items-start gap-2 text-sm font-medium">
                    {!item.read ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-label="Non lue" /> : null}
                    <span>{item.title}</span>
                  </p>
                  {item.body ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p> : null}
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{formatDateTime(item.createdAt)}</p>
                </>
              );
              return (
                <li key={item.id}>
                  {item.link ? (
                    <Link href={item.link} onClick={() => void onOpenChange(false)} className={cn("block px-4 py-3 transition-colors hover:bg-muted")}>
                      {content}
                    </Link>
                  ) : (
                    <div className="px-4 py-3">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
