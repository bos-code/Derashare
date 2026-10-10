import { useCallback, useState } from "react";

// In-app toast, plus a system notification when the tab is hidden and permission was granted.
export function useNotify() {
  const [toast, setToast] = useState("");

  const notify = useCallback((body: string) => {
    setToast(body);
    setTimeout(() => setToast(""), 2600);
    if (document.hidden && "Notification" in window && Notification.permission === "granted")
      new Notification("Dera Share", { body });
    if ("vibrate" in navigator) navigator.vibrate(80);
  }, []);

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    notify(permission === "granted" ? "Notifications enabled" : "Notifications were not enabled");
  }, [notify]);

  return { toast, notify, enableNotifications };
}
