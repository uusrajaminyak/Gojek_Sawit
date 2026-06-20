import { supabase } from "../supabase";

// Mengambil data pesanan aktif dan riwayat bulan ini khusus untuk kerani yang sedang login.
export const fetchKeraniData = async (keraniId) => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: orders, error } = await supabase
    .from("orders")
    .select("*")
    .eq("kerani_id", keraniId)
    .gte("created_at", startOfMonth.toISOString())
    .order("created_at", { ascending: false });

  if (error || !orders) return null;

  const driverIds = [
    ...new Set(orders.map((o) => o.driver_id).filter(Boolean)),
  ];
  const drivers = {};

  if (driverIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, nama_lengkap")
      .in("id", driverIds);

    if (profiles) {
      profiles.forEach((p) => {
        drivers[p.id] = p.nama_lengkap;
      });
    }
  }

  const active = [];
  const history = [];

  orders.forEach((o) => {
    const orderData = {
      ...o,
      driver_name: drivers[o.driver_id] || "Mencari Supir",
    };
    if (["pending", "assigned", "in_progress"].includes(o.status)) {
      active.push(orderData);
    } else if (o.status === "completed") {
      history.push(orderData);
    }
  });

  return { active, history };
};
