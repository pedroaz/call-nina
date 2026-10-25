import welcome from "@call-nina/design-system/brand/nina-welcome.png";
import listening from "@call-nina/design-system/brand/nina-listening.png";
import thinking from "@call-nina/design-system/brand/nina-thinking.png";
import celebration from "@call-nina/design-system/brand/nina-celebration.png";
import styles from "./Nina.module.css";

const poses = { welcome, listening, thinking, celebration };
/** Decorative companion; the surrounding control or status owns its accessible name. */
export function Nina({
  pose = "welcome",
  size = "small",
}: {
  pose?: keyof typeof poses;
  size?: "small" | "medium" | "hero";
}) {
  return (
    <img
      className={styles.nina}
      data-size={size}
      src={poses[pose]}
      alt=""
      aria-hidden="true"
      width={160}
      height={160}
      draggable={false}
    />
  );
}
