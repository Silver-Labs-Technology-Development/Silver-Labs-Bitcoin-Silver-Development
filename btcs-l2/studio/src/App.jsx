import React from 'react'
import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Nodes from './pages/Nodes'
import TokenStudio from './pages/TokenStudio'
import Transactions from './pages/Transactions'
import SilverPayWallet from './pages/SilverPayWallet'

function App() {
  return (
    <div>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <nav className="nav" aria-label="Main navigation">
        <NavLink to="/" className="nav-logo"><span aria-hidden="true">S</span> Silver Labs <span aria-hidden="true">·</span> BTCS L2 Studio</NavLink>
        <div className="nav-links">
          <NavLink to="/" className="nav-link">Dashboard</NavLink>
          <NavLink to="/nodes" className="nav-link">Nodes</NavLink>
          <NavLink to="/tokens" className="nav-link">Token Studio</NavLink>
          <NavLink to="/transactions" className="nav-link">Transactions</NavLink>
          <NavLink to="/silverpay" className="nav-link">SilverPay</NavLink>
        </div>
        <div className="nav-status">EXPERIMENTAL · SINGLE-OPERATOR</div>
      </nav>
      <main id="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/nodes" element={<Nodes />} />
          <Route path="/tokens" element={<TokenStudio />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/silverpay" element={<SilverPayWallet />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
