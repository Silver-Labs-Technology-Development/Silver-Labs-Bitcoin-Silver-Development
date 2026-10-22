#include <qt/silverforgepage.h>
#include <qt/forms/ui_silverforgepage.h>
#include <qt/walletmodel.h>
#include <qt/platformstyle.h>

#include <QTimer>

SilverForgePage::SilverForgePage(const PlatformStyle *_platformStyle, QWidget *parent) :
    QWidget(parent),
    ui(new Ui::SilverForgePage),
    model(nullptr),
    platformStyle(_platformStyle)
{
    ui->setupUi(this);
    
    // Apply Bitcoin Silver silver-blue theme
    setStyleSheet(
        "SilverForgePage { background-color: #0b0c0e; }"
        ".QLabel { color: #e5e7eb; }"
        ".QGroupBox { color: #60a5fa; border: 1px solid #1f2937; border-radius: 8px; margin-top: 12px; padding-top: 12px; }"
        ".QGroupBox::title { subcontrol-origin: margin; left: 10px; padding: 0 5px; }"
        ".QPushButton { background-color: #1e40af; color: #e5e7eb; border: 1px solid #3b82f6; border-radius: 6px; padding: 6px 12px; }"
        ".QPushButton:hover { background-color: #2563eb; }"
        ".QPushButton:disabled { background-color: #1f2937; color: #6b7280; border-color: #374151; }"
    );
    
    QTimer *timer = new QTimer(this);
    connect(timer, &QTimer::timeout, this, &SilverForgePage::updateL2Status);
    timer->start(5000);
    
    updateL2Status();
}

SilverForgePage::~SilverForgePage()
{
    delete ui;
}

void SilverForgePage::setModel(WalletModel *_model)
{
    this->model = _model;
}

void SilverForgePage::updateL2Status()
{
    // L2 status - would connect to actual L2 RPC
    ui->l2StatusLabel->setText(tr("L2 Status: Not Connected"));
    ui->chainIdLabel->setText(tr("Chain ID: 31337 (Development)"));
}
