import { createContext } from 'react';

/**
 * The left rail column, handed to a route that lists its own items there instead of the agents
 * (Chats mode). Null outside AgentsView (tests, web without the rail): the route renders inline.
 */
export const RailOutletContext = createContext<HTMLElement | null>(null);
