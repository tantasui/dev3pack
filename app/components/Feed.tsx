import { FC, useEffect, useRef, useState } from "react";
import { VIDEOS } from "../lib/mockData";
import VideoCard from "./VideoCard";

const Feed: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const idx = parseInt(
              (entry.target as HTMLElement).dataset.index ?? "0",
              10
            );
            setActiveIndex(idx);
          }
        });
      },
      { threshold: 0.6, root: container }
    );

    const cards = container.querySelectorAll(".feed-card");
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="feed-container">
      {VIDEOS.map((video, index) => (
        <div key={video.id} data-index={index} className="feed-card">
          <VideoCard video={video} isActive={activeIndex === index} />
        </div>
      ))}
    </div>
  );
};

export default Feed;
