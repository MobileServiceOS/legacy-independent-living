/** CLI: post due rent + late fees + reminders. `npm run rent:run` (add APP_TODAY=YYYY-MM-DD to simulate a date). */
import { prisma } from "../src/lib/db";
import { deliverPendingNotifications } from "../src/lib/notify";
import { runRentEngine } from "../src/server/rent-engine";

runRentEngine()
  .then(async (r) => {
    console.log("rent engine:", r);
    console.log("notifications:", await deliverPendingNotifications());
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
