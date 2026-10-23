// Render unchanged Git sources; this file supplies display fixtures only.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {DineInOrderView} from 'baseline-dine';
import {TakeawayOrderView} from 'baseline-takeaway';
import {KitchenKdsBoard} from 'baseline-kitchen';
import {StaffDashboard} from 'baseline-staff';
import {session,table,zone,menu,order,staff} from './peer.mjs';
import 'baseline-css';
const screen=new URLSearchParams(location.search).get('screen');
createRoot(document.getElementById('root')).render(screen==='takeaway'?<TakeawayOrderView initialMenuItems={menu}/>:
 screen==='kitchen'?<KitchenKdsBoard initialKitchenOrders={[order]} initialActiveSessions={[session]} tables={[table]} initialMenuItems={menu}/>:
 screen==='staff'?<StaffDashboard initialZones={[zone]} initialTables={[table]} initialSessions={[session]} initialOrderItems={[order]} menuItems={menu} initialIngredients={[]} staffProfiles={[staff]} currentStaffId={staff.id} currentStaffRole="staff"/>:
 <DineInOrderView initialSession={session} table={table} zone={zone} initialMenuItems={menu} initialSessionOrders={[order]} initialGlobalKitchenQueue={[order]} initialIngredients={[]}/>);
